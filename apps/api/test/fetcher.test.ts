import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A fake enough of Playwright's Page.route() to exercise guardNavigation's
 * routing decisions without a real browser - captures the handler so a
 * test can drive it directly against fake requests of a given resourceType.
 */
function fakePage() {
  let handler: ((route: unknown) => Promise<void>) | null = null;
  return {
    page: {
      route: vi.fn(async (_pattern: string, h: (route: unknown) => Promise<void>) => {
        handler = h;
      }),
    },
    async dispatch(resourceType: string, url = 'https://example.com/') {
      const request = { resourceType: () => resourceType, url: () => url };
      const route = { request: () => request, continue: vi.fn(), abort: vi.fn() };
      await handler!(route);
      return route;
    },
  };
}

describe('guardNavigation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('blocks image/media/font requests when blockMedia is on - the memory-heaviest part of rendering a page we only read text/links from', async () => {
    vi.doMock('../src/services/urlSafety.js', () => ({
      assertSafeUrl: vi.fn().mockResolvedValue(undefined),
      UnsafeUrlError: class extends Error {},
      safeFetch: vi.fn(),
    }));
    const { guardNavigation } = await import('../src/services/fetcher.js');
    const { page, dispatch } = fakePage();

    await guardNavigation(page as never, { blockMedia: true });

    for (const type of ['image', 'media', 'font']) {
      const route = await dispatch(type);
      expect(route.abort).toHaveBeenCalled();
      expect(route.continue).not.toHaveBeenCalled();
    }
  });

  it('never blocks image/media/font by default - screenshots (routes/screenshot.ts) share this same function and need real images', async () => {
    vi.doMock('../src/services/urlSafety.js', () => ({
      assertSafeUrl: vi.fn().mockResolvedValue(undefined),
      UnsafeUrlError: class extends Error {},
      safeFetch: vi.fn(),
    }));
    const { guardNavigation } = await import('../src/services/fetcher.js');
    const { page, dispatch } = fakePage();

    await guardNavigation(page as never);

    const route = await dispatch('image');
    expect(route.continue).toHaveBeenCalled();
    expect(route.abort).not.toHaveBeenCalled();
  });

  it('still lets non-media sub-resources (script, stylesheet, xhr) through even with blockMedia on - a JS-rendered SPA needs its own script/XHR to hydrate', async () => {
    vi.doMock('../src/services/urlSafety.js', () => ({
      assertSafeUrl: vi.fn().mockResolvedValue(undefined),
      UnsafeUrlError: class extends Error {},
      safeFetch: vi.fn(),
    }));
    const { guardNavigation } = await import('../src/services/fetcher.js');
    const { page, dispatch } = fakePage();

    await guardNavigation(page as never, { blockMedia: true });

    for (const type of ['script', 'stylesheet', 'xhr', 'fetch']) {
      const route = await dispatch(type);
      expect(route.continue).toHaveBeenCalled();
      expect(route.abort).not.toHaveBeenCalled();
    }
  });

  it('still applies the SSRF guard to document navigation regardless of blockMedia', async () => {
    const assertSafeUrl = vi.fn().mockRejectedValue(new Error('unsafe'));
    vi.doMock('../src/services/urlSafety.js', () => ({
      assertSafeUrl,
      UnsafeUrlError: class extends Error {},
      safeFetch: vi.fn(),
    }));
    const { guardNavigation } = await import('../src/services/fetcher.js');
    const { page, dispatch } = fakePage();

    await guardNavigation(page as never, { blockMedia: true });

    const route = await dispatch('document', 'http://169.254.169.254/');
    expect(assertSafeUrl).toHaveBeenCalledWith('http://169.254.169.254/');
    expect(route.abort).toHaveBeenCalled();
  });
});

describe('fetchWithBrowser', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('gives up and releases the shared browser slot instead of hanging forever when browser.newContext() never settles', async () => {
    // The real-world case: browser.newContext() (and context.newPage(),
    // page.content(), context.close()) have no timeout of their own,
    // unlike page.goto()'s 30s one - a wedged-but-not-crashed browser
    // process hanging on any of them used to leave withBrowserSlot's
    // single global slot (services/browser.ts) held forever, silently
    // deadlocking every future browser-driven fetch across the whole app,
    // not just this one page.
    vi.doMock('playwright', () => ({
      chromium: {
        launch: vi.fn(() =>
          Promise.resolve({
            newContext: vi.fn(() => new Promise(() => {})), // never resolves
            close: vi.fn(() => Promise.resolve()),
          }),
        ),
      },
    }));

    const { fetchWithBrowser } = await import('../src/services/fetcher.js');
    const { withBrowserSlot } = await import('../src/services/browser.js');

    const stuck = fetchWithBrowser('https://example.com/stuck', 'UA', 0);
    // Attached in the same tick the promise is created, so Node never sees
    // it as briefly "unhandled" once fake-timer advancement lets it settle
    // further down - the actual assertion still only resolves once awaited.
    const stuckAssertion = expect(stuck).rejects.toThrow(/timed out after 45000ms/i);

    // Let the microtask queue drain so the call is genuinely inside
    // withBrowserSlot (holding the slot) before advancing the clock.
    await vi.advanceTimersByTimeAsync(0);

    const secondSlotAcquired = vi.fn();
    const second = withBrowserSlot(async () => {
      secondSlotAcquired();
      return 'second-ran';
    });

    // Still stuck - the slot must not be free before the timeout fires.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(secondSlotAcquired).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(45_000);

    await stuckAssertion;
    // The slot was actually released - a call queued behind the stuck one
    // gets to run instead of waiting forever behind it too.
    await expect(second).resolves.toBe('second-ran');
    expect(secondSlotAcquired).toHaveBeenCalledTimes(1);
  });

  it('reports success even when context.close() throws afterward - a close-time failure must never overwrite a result that already succeeded', async () => {
    // Confirmed in production: a page that navigated and rendered
    // perfectly fine was still being reported as a failed fetch the
    // instant context.close() threw ("Protocol error: Failed to find
    // context", "Target page, context or browser has been closed") -
    // `finally { await context.close(); }` with no try/catch of its own
    // let that close-time error silently replace the successful `return`
    // from the try block above it. Worse, that second message also
    // matches the fatal-browser-error check below, so it triggered an
    // unnecessary full browser restart on what was actually a perfectly
    // good page.
    const page = {
      route: vi.fn((_pattern: string, handler: (route: unknown) => Promise<void>) => {
        void handler;
        return Promise.resolve();
      }),
      goto: vi.fn(() => Promise.resolve({ status: () => 200 })),
      waitForTimeout: vi.fn(() => Promise.resolve()),
      content: vi.fn(() => Promise.resolve('<html>ok</html>')),
      url: vi.fn(() => 'https://example.com/ok'),
    };
    const context = {
      newPage: vi.fn(() => Promise.resolve(page)),
      close: vi.fn(() => Promise.reject(new Error('Target page, context or browser has been closed'))),
    };
    vi.doMock('playwright', () => ({
      chromium: {
        launch: vi.fn(() => Promise.resolve({ newContext: vi.fn(() => Promise.resolve(context)) })),
      },
    }));

    const { fetchWithBrowser } = await import('../src/services/fetcher.js');
    const result = await fetchWithBrowser('https://example.com/ok', 'UA', 0);

    expect(result.html).toBe('<html>ok</html>');
    expect(result.statusCode).toBe(200);
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('recycles the shared browser when Chromium itself reports a fatal, page-independent failure - a real renderer crash rejects immediately, well before the 45s timeout branch ever gets a chance to fire', async () => {
    // This recycling decision used to live in crawlWorker.ts, checked
    // AFTER scrapePage() had already returned - by which point
    // withBrowserSlot (services/browser.ts) had already released its
    // single app-wide slot, so a different concurrently running job
    // (concurrency: 3) could already be mid-fetch on a brand new browser
    // instance by the time that stale, context-unaware check ran, and its
    // closeBrowser() call would tear that job's healthy browser out from
    // under it - producing the exact same "browser has been closed" error
    // and making THAT job recycle too, a self-sustaining storm from one
    // initial crash. Deciding it here instead, inside withBrowserSlot, is
    // safe: at most one browser-driven fetch is ever in flight app-wide,
    // so there's no other job's browser this could possibly be racing.
    // Real timers (overriding this describe block's default fake ones) -
    // closeBrowser() is mocked away below, but the backoff after it
    // (fetcher.ts, unmocked) is a real ~3s timer regardless, and fake
    // timers proved unreliable against this file's layered Promise.race/
    // setTimeout chains for more than one shape of this test (see the
    // "waits about RELAUNCH_BACKOFF_MS..." test further down for the
    // details) - not worth re-litigating per test, so this uses the same
    // reliable real-timer approach.
    vi.useRealTimers();
    const closeBrowser = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../src/services/browser.js', async () => {
      const actual = await vi.importActual<typeof import('../src/services/browser.js')>('../src/services/browser.js');
      return { ...actual, closeBrowser };
    });
    const page = {
      route: vi.fn((_pattern: string, handler: (route: unknown) => Promise<void>) => {
        void handler;
        return Promise.resolve();
      }),
      goto: vi.fn(() => Promise.reject(new Error('page.goto: Page crashed'))),
    };
    const context = {
      newPage: vi.fn(() => Promise.resolve(page)),
      close: vi.fn(() => Promise.resolve()),
    };
    vi.doMock('playwright', () => ({
      chromium: {
        launch: vi.fn(() => Promise.resolve({ newContext: vi.fn(() => Promise.resolve(context)) })),
      },
    }));

    const { fetchWithBrowser } = await import('../src/services/fetcher.js');
    await expect(fetchWithBrowser('https://example.com/crash', 'UA', 0)).rejects.toThrow(/page crashed/i);

    expect(closeBrowser).toHaveBeenCalledTimes(1);
  }, 8_000);

  it('never recycles the browser for an ordinary navigation failure - the browser itself is fine', async () => {
    const closeBrowser = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../src/services/browser.js', async () => {
      const actual = await vi.importActual<typeof import('../src/services/browser.js')>('../src/services/browser.js');
      return { ...actual, closeBrowser };
    });
    const page = {
      route: vi.fn((_pattern: string, handler: (route: unknown) => Promise<void>) => {
        void handler;
        return Promise.resolve();
      }),
      goto: vi.fn(() => Promise.reject(new Error('net::ERR_CONNECTION_RESET'))),
    };
    const context = {
      newPage: vi.fn(() => Promise.resolve(page)),
      close: vi.fn(() => Promise.resolve()),
    };
    vi.doMock('playwright', () => ({
      chromium: {
        launch: vi.fn(() => Promise.resolve({ newContext: vi.fn(() => Promise.resolve(context)) })),
      },
    }));

    const { fetchWithBrowser } = await import('../src/services/fetcher.js');
    await expect(fetchWithBrowser('https://example.com/reset', 'UA', 0)).rejects.toThrow(/ERR_CONNECTION_RESET/i);

    expect(closeBrowser).not.toHaveBeenCalled();
  });

  it('waits about RELAUNCH_BACKOFF_MS before settling after a chromium.launch() failure, not just a mid-operation crash', async () => {
    // getBrowser() (browser.ts) already nulls its own memoized promise in
    // its own catch handler before this code ever runs, so closeBrowser()
    // sees nothing to close and returns immediately - a backoff placed
    // only inside closeBrowser() (a first attempt at this fix) never
    // fired for this exact failure mode. Confirmed in production as the
    // majority shape: 45 of 59 browser-crash failures in one job were
    // launch failures, still retrying every ~2s with no pause at all
    // even after that first fix had already shipped.
    //
    // Uses real timers (overriding this describe block's default fake
    // ones) and measures real elapsed time instead. The layered
    // Promise.race/setTimeout chains here (chromium.launch()'s own 20s
    // timeout, fetchWithBrowser's 45s timeout, this 3s backoff) proved
    // unreliable against fake timers for this specific
    // rejects-immediately shape - both vi.advanceTimersByTimeAsync() with
    // an intermediate "not yet settled" check (flaky, ~1 run in 5) and
    // vi.runAllTimersAsync() (deterministically settled via the wrong
    // branch, the 45s timeout, instead of the launch failure) misbehaved
    // here. A real ~3s wait is simple and actually reliable.
    vi.useRealTimers();
    vi.doMock('playwright', () => ({
      chromium: {
        launch: vi.fn(() =>
          Promise.reject(new Error('browserType.launch: Target page, context or browser has been closed')),
        ),
      },
    }));
    // A sibling test in this describe block leaves a stale
    // vi.doMock('../src/services/browser.js', ...) registered - resetModules()
    // alone doesn't clear a doMock factory, only the resolved-module cache -
    // so without this, fetcher.ts's own import of browser.js would silently
    // resolve through that leftover mock instead of the real module.
    vi.doUnmock('../src/services/browser.js');

    const { fetchWithBrowser } = await import('../src/services/fetcher.js');
    const { RELAUNCH_BACKOFF_MS } = await import('../src/services/browser.js');

    const start = Date.now();
    await expect(fetchWithBrowser('https://example.com/launch-fail', 'UA', 0)).rejects.toThrow(
      /browser has been closed/i,
    );
    const elapsed = Date.now() - start;

    // A little tolerance below RELAUNCH_BACKOFF_MS for timer granularity -
    // what matters is that it's actually close to the real backoff, not
    // the near-zero elapsed time an unapplied backoff would show.
    expect(elapsed).toBeGreaterThanOrEqual(RELAUNCH_BACKOFF_MS - 50);
  }, 8_000);
});
