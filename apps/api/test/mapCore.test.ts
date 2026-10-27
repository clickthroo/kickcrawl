import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('runMap', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.doUnmock('../src/services/sitemap.js');
    vi.doUnmock('../src/lib/urlStore.js');
  });

  const SITEMAP_URLS = [
    'https://example.com/products/arsenal-shirt',
    'https://example.com/products/chelsea-shirt',
    'https://example.com/collections/all',
    'https://example.com/collections/arsenal',
    'https://example.com/blogs/news/some-post',
    'https://example.com/account/login',
  ];

  async function runWithMocks(opts: Record<string, unknown>) {
    vi.doMock('../src/services/sitemap.js', () => ({
      getAllSitemapUrls: vi.fn(async () => SITEMAP_URLS),
    }));
    const upsertDiscoveredUrls = vi.fn(async () => undefined);
    vi.doMock('../src/lib/urlStore.js', () => ({ upsertDiscoveredUrls }));

    const { runMap } = await import('../src/lib/mapCore.js');
    const result = await runMap('https://example.com', 'site-1', opts);
    return { result, upsertDiscoveredUrls };
  }

  it('persists every same-site sitemap URL when no includePaths/excludePaths are given - unchanged default behaviour', async () => {
    const { result, upsertDiscoveredUrls } = await runWithMocks({});

    expect(result).toEqual(SITEMAP_URLS);
    expect(upsertDiscoveredUrls).toHaveBeenCalledWith('site-1', SITEMAP_URLS);
  });

  it('this is the actual production fix: scopes persisted URLs to includePaths, so a Shopify sitemap index\'s collection/blog/account pages no longer flood the urls table', async () => {
    // Confirmed as the real prior behaviour: thesoccerarchive.com had its
    // `urls` table wiped clean (Clear items) after a crawl fix scoped the
    // CRAWL's own sitemap seeding to allowed_paths, then a single Map run
    // alone put all ~13,900 unscoped sitemap URLs straight back in,
    // undoing the fix without a single crawl page ever being fetched -
    // runMap had its own, entirely separate, unscoped sitemap-reading path.
    const { result, upsertDiscoveredUrls } = await runWithMocks({ includePaths: ['/products/*'] });

    expect(result).toEqual([
      'https://example.com/products/arsenal-shirt',
      'https://example.com/products/chelsea-shirt',
    ]);
    expect(upsertDiscoveredUrls).toHaveBeenCalledWith('site-1', [
      'https://example.com/products/arsenal-shirt',
      'https://example.com/products/chelsea-shirt',
    ]);
  });

  it('also respects excludePaths, same as a crawl\'s own denied_paths', async () => {
    const { result } = await runWithMocks({ excludePaths: ['/account*'] });

    expect(result).not.toContain('https://example.com/account/login');
    expect(result).toHaveLength(SITEMAP_URLS.length - 1);
  });

  it('applies includePaths and excludePaths together', async () => {
    const { result } = await runWithMocks({
      includePaths: ['/products/*', '/collections/*'],
      excludePaths: ['/collections/all'],
    });

    expect(result).toEqual([
      'https://example.com/products/arsenal-shirt',
      'https://example.com/products/chelsea-shirt',
      'https://example.com/collections/arsenal',
    ]);
  });
});
