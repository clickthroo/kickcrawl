import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('getBrowser', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('clears the memoized promise on failure so the next call gets a fresh attempt', async () => {
    let attempts = 0;
    vi.doMock('playwright', () => ({
      chromium: {
        launch: vi.fn(() => {
          attempts += 1;
          if (attempts === 1) return Promise.reject(new Error('boom'));
          return Promise.resolve({ marker: 'fresh-browser' });
        }),
      },
    }));

    const { getBrowser } = await import('../src/services/browser.js');

    // The first call fails - if the rejected promise stayed cached, every
    // later call would keep re-throwing the same "boom" forever instead
    // of ever launching again.
    await expect(getBrowser()).rejects.toThrow('boom');

    const second = await getBrowser();
    expect(second).toEqual({ marker: 'fresh-browser' });
    expect(attempts).toBe(2);
  });

  it('memoizes a successful launch instead of relaunching on every call', async () => {
    const launch = vi.fn(() => Promise.resolve({ marker: 'shared-browser' }));
    vi.doMock('playwright', () => ({ chromium: { launch } }));

    const { getBrowser } = await import('../src/services/browser.js');

    const first = await getBrowser();
    const second = await getBrowser();
    expect(first).toBe(second);
    expect(launch).toHaveBeenCalledTimes(1);
  });
});

describe('closeBrowser', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('resets the memoized browser even when close() itself throws - the exact case for a browser already crashed', async () => {
    // Confirmed in production: after a Chromium crash, browser.close()
    // against the already-dead instance threw "Target closed", which used
    // to skip resetting the memoized promise entirely - every later
    // getBrowser() call kept returning that same dead browser, so every
    // subsequent fetch crashed immediately too, back-to-back, until the
    // whole container was killed and restarted.
    let launches = 0;
    vi.doMock('playwright', () => ({
      chromium: {
        launch: vi.fn(() => {
          launches += 1;
          return Promise.resolve({
            marker: `browser-${launches}`,
            close: vi.fn(() => Promise.reject(new Error('Target closed'))),
          });
        }),
      },
    }));

    const { getBrowser, closeBrowser } = await import('../src/services/browser.js');

    const first = await getBrowser();
    expect(first).toEqual(expect.objectContaining({ marker: 'browser-1' }));

    await closeBrowser();

    const second = await getBrowser();
    expect(second).toEqual(expect.objectContaining({ marker: 'browser-2' }));
    expect(launches).toBe(2);
  });

  it('does nothing when there is no memoized browser to close', async () => {
    const { closeBrowser } = await import('../src/services/browser.js');
    await expect(closeBrowser()).resolves.toBeUndefined();
  });

  it('closes a healthy browser normally and lets the next call launch fresh', async () => {
    let launches = 0;
    const close = vi.fn(() => Promise.resolve());
    vi.doMock('playwright', () => ({
      chromium: {
        launch: vi.fn(() => {
          launches += 1;
          return Promise.resolve({ marker: `browser-${launches}`, close });
        }),
      },
    }));

    const { getBrowser, closeBrowser } = await import('../src/services/browser.js');

    await getBrowser();
    await closeBrowser();

    expect(close).toHaveBeenCalledTimes(1);
    const second = await getBrowser();
    expect(second).toEqual(expect.objectContaining({ marker: 'browser-2' }));
  });
});

describe('withBrowserSlot', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('runs a single call straight through', async () => {
    const { withBrowserSlot } = await import('../src/services/browser.js');
    const result = await withBrowserSlot(async () => 'done');
    expect(result).toBe('done');
  });

  it('caps concurrent calls at the configured slot limit - a third one never starts until an earlier one releases', async () => {
    // The real-world case this guards against: several BullMQ workers
    // (crawl concurrency 3, plus the recheck worker) each mid-fetch on a
    // JS-heavy site at once - repeatedly crashed the container's V8 heap
    // in production. Capping concurrent browser-driven fetches is the
    // actual fix; this asserts the cap itself (currently 2) rather than
    // hardcoding "exactly one," so it stays correct if that number is
    // retuned again after further production memory measurements.
    const events: string[] = [];
    const releasers: (() => void)[] = [];

    const { withBrowserSlot } = await import('../src/services/browser.js');

    function slot(name: string) {
      return withBrowserSlot(async () => {
        events.push(`${name}:start`);
        await new Promise<void>((resolve) => releasers.push(resolve));
        events.push(`${name}:end`);
        return name;
      });
    }

    const first = slot('first');
    const second = slot('second');
    const third = slot('third');

    await new Promise((r) => setTimeout(r, 10));
    // Exactly the slot limit's worth of calls have started; the third is
    // still queued behind them.
    expect(events).toEqual(['first:start', 'second:start']);

    releasers[0]();
    await first;
    expect(events).toContain('third:start');

    releasers[1]();
    releasers[2]();
    const [firstResult, secondResult, thirdResult] = await Promise.all([first, second, third]);
    expect(firstResult).toBe('first');
    expect(secondResult).toBe('second');
    expect(thirdResult).toBe('third');
  });

  it('releases the slot even when the wrapped call throws, so one failure never wedges every later fetch', async () => {
    const { withBrowserSlot } = await import('../src/services/browser.js');

    await expect(
      withBrowserSlot(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const result = await withBrowserSlot(async () => 'still works');
    expect(result).toBe('still works');
  });
});
