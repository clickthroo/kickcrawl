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
