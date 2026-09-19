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
    // matches scrapePageWithTimeout's browserFatal detection
    // (crawlWorker.ts), so it triggered an unnecessary full browser
    // restart on what was actually a perfectly good page.
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
});
