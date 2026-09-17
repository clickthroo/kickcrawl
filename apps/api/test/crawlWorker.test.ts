import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { filterTraversableLinks, isCrawlItem, passesSellerFilter } from '../src/workers/crawlWorker.js';

describe('filterTraversableLinks', () => {
  it('drops already-visited links', () => {
    const visited = new Set(['https://example.com/products/1']);
    const result = filterTraversableLinks(
      ['https://example.com/products/1', 'https://example.com/products/2'],
      visited,
      [],
    );
    expect(result).toEqual(['https://example.com/products/2']);
  });

  it('keeps stepping-stone links even though they are outside allowed_paths - that check happens elsewhere', () => {
    // The real-world case: Cult Kits' category/collection pages aren't
    // themselves product pages, but the crawl needs to visit them to
    // ever reach the products linked from them. Traversal is not
    // allow-list gated, only denied_paths stops a link from being
    // followed at all.
    const links = [
      'https://cultkits.com/collections/mens-shirts',
      'https://cultkits.com/products/some-shirt',
    ];
    const result = filterTraversableLinks(links, new Set(), []);
    expect(result).toEqual(links);
  });

  it('denied_paths excludes matching links from traversal entirely', () => {
    const links = ['https://example.com/products/1', 'https://example.com/admin/secret'];
    const result = filterTraversableLinks(links, new Set(), ['/admin/*']);
    expect(result).toEqual(['https://example.com/products/1']);
  });

  it('keeps everything when no denied paths are configured', () => {
    const links = ['https://example.com/anything', 'https://example.com/whatever'];
    const result = filterTraversableLinks(links, new Set(), []);
    expect(result).toEqual(links);
  });
});

describe('isCrawlItem', () => {
  it('the real-world repro: a Cult Kits category page is not an item, a product page is', () => {
    expect(isCrawlItem('/collections/mens-shirts', ['/products/*'])).toBe(false);
    expect(isCrawlItem('/products/some-shirt', ['/products/*'])).toBe(true);
  });

  it('marketing/footer pages are not items when allowed_paths is scoped to products', () => {
    expect(isCrawlItem('/pages/join-the-affiliate-program', ['/products/*'])).toBe(false);
  });

  it('everything is an item when no allowed_paths is configured', () => {
    expect(isCrawlItem('/anything', [])).toBe(true);
  });

  it('an exact allowed_paths entry with no wildcard only matches that exact path', () => {
    expect(isCrawlItem('/products', ['/products'])).toBe(true);
    expect(isCrawlItem('/products/some-shirt', ['/products'])).toBe(false);
  });
});

describe('scrapePageWithTimeout', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock('../src/lib/scrapeCore.js');
  });

  it('resolves with the real result when scrapePage finishes well within the timeout', async () => {
    const fastResult = { success: true, metadata: { sourceURL: 'https://example.com', statusCode: 200 } };
    vi.doMock('../src/lib/scrapeCore.js', () => ({ scrapePage: async () => fastResult }));

    const { scrapePageWithTimeout } = await import('../src/workers/crawlWorker.js');
    const result = await scrapePageWithTimeout('https://example.com', {}, null);

    expect(result).toBe(fastResult);
  });

  it('falls back to a timeout failure if the underlying scrape never settles', async () => {
    // Every individual I/O call inside scrapePage() already has its own
    // timeout, but this is the catch-all for anything that doesn't - e.g.
    // a hang in browser.newContext() or context.close() that none of the
    // inner guards cover. Simulate that by never resolving.
    vi.doMock('../src/lib/scrapeCore.js', () => ({ scrapePage: () => new Promise(() => {}) }));

    const { scrapePageWithTimeout, PAGE_TIMEOUT_MS } = await import('../src/workers/crawlWorker.js');
    const promise = scrapePageWithTimeout('https://example.com/stuck', {}, null);
    await vi.advanceTimersByTimeAsync(PAGE_TIMEOUT_MS);
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/timed out/i);
    expect(result.metadata.sourceURL).toBe('https://example.com/stuck');
  });

  it('is generous enough not to mask legitimately slow (but working) pages', async () => {
    const { PAGE_TIMEOUT_MS } = await import('../src/workers/crawlWorker.js');
    expect(PAGE_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });
});

describe('passesSellerFilter', () => {
  it('passes everything when the site has no seller filter configured - most sites have no such concept', () => {
    const site = { require_pro_seller: false, min_seller_feedback: null };
    expect(passesSellerFilter('anything at all', site)).toBe(true);
    expect(passesSellerFilter(undefined, site)).toBe(true);
  });

  it('keeps a Pro seller item when require_pro_seller is set', () => {
    const site = { require_pro_seller: true, min_seller_feedback: null };
    expect(passesSellerFilter('Cushty Kits\n524\nPro', site)).toBe(true);
  });

  it('drops a non-Pro seller item when require_pro_seller is set', () => {
    const site = { require_pro_seller: true, min_seller_feedback: null };
    expect(passesSellerFilter('mark7424\n138\nFrequent Uploads', site)).toBe(false);
  });

  it('keeps an item whose feedback count meets min_seller_feedback', () => {
    const site = { require_pro_seller: false, min_seller_feedback: 100 };
    expect(passesSellerFilter('Cushty Kits\n524\nPro', site)).toBe(true);
  });

  it('drops an item whose feedback count is below min_seller_feedback', () => {
    const site = { require_pro_seller: false, min_seller_feedback: 100 };
    expect(passesSellerFilter('New Seller\n12\nPro', site)).toBe(false);
  });

  it('fails closed when a filter is configured but there is no content to check at all', () => {
    // A page we can't confirm passes shouldn't be kept just because we
    // couldn't check it - the failed-fetch case, not a passing default.
    const site = { require_pro_seller: true, min_seller_feedback: null };
    expect(passesSellerFilter(undefined, site)).toBe(false);
  });

  it('requires both filters to pass when both are configured', () => {
    const site = { require_pro_seller: true, min_seller_feedback: 1000 };
    // Pro, but feedback count (524) is below the 1000 threshold.
    expect(passesSellerFilter('Cushty Kits\n524\nPro', site)).toBe(false);
  });
});
