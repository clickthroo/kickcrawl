import { beforeEach, describe, expect, it, vi } from 'vitest';

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
