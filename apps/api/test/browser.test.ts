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

  it('serializes concurrent calls - a second one never starts until the first releases its slot', async () => {
    // The real-world case this guards against: several BullMQ workers
    // (crawl concurrency 3, plus the recheck worker) each mid-fetch on a
    // JS-heavy site at once - repeatedly crashed the container's V8 heap
    // in production. Capping this to one at a time is the actual fix, so
    // what matters here is that a second call's body provably never
    // starts running while the first is still inside its slot.
    const events: string[] = [];
    let releaseFirst!: () => void;

    const { withBrowserSlot } = await import('../src/services/browser.js');

    const first = withBrowserSlot(async () => {
      events.push('first:start');
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      events.push('first:end');
      return 'first';
    });

    const second = withBrowserSlot(async () => {
      events.push('second:start');
      return 'second';
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(events).toEqual(['first:start']);

    releaseFirst();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
    expect(firstResult).toBe('first');
    expect(secondResult).toBe('second');
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
