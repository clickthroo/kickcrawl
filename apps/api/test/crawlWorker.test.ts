import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  catalogIdFromUrl,
  filterTraversableLinks,
  isCrawlItem,
  passesSellerFilter,
  resolveUseBrowser,
} from '../src/workers/crawlWorker.js';

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

describe('catalogIdFromUrl', () => {
  it('reads the catalog id from a query param, the seed URL shape', () => {
    expect(
      catalogIdFromUrl('https://www.vinted.co.uk/catalog?search_text=&catalog[]=3267&size_ids[]=206'),
    ).toBe('3267');
  });

  it('reads the catalog id from a category page\'s own path, the breadcrumb link shape', () => {
    expect(catalogIdFromUrl('https://www.vinted.co.uk/catalog/3267-team-shirts-and-jerseys')).toBe('3267');
  });

  it('reads the catalog id from a brand-filtered sub-catalog path', () => {
    expect(
      catalogIdFromUrl('https://www.vinted.co.uk/catalog/3267-team-shirts-and-jerseys/brand/269830-arsenal'),
    ).toBe('3267');
  });

  it('reads a different catalog id for an unrelated parent/sibling category', () => {
    // Real examples from production: breadcrumb/nav links on a "Team
    // shirts & jerseys" (3267) page that lead back up to much broader
    // categories.
    expect(catalogIdFromUrl('https://www.vinted.co.uk/catalog/5-men?referrer=item-crumbs')).toBe('5');
    expect(catalogIdFromUrl('https://www.vinted.co.uk/catalog/2050-clothing?referrer=item-crumbs')).toBe(
      '2050',
    );
    expect(catalogIdFromUrl('https://www.vinted.co.uk/catalog/30-activewear')).toBe('30');
  });

  it('returns null for a URL that is not itself a catalog listing - an item page, the homepage, a help page', () => {
    // An item URL never encodes its category at all, so this can only
    // ever be enforced at the catalog-page level, not by checking an
    // item link's own URL.
    expect(catalogIdFromUrl('https://www.vinted.co.uk/items/10033671773-adidas-condivo-22')).toBeNull();
    expect(catalogIdFromUrl('https://www.vinted.co.uk/')).toBeNull();
    expect(catalogIdFromUrl('https://www.vinted.co.uk/help?access_channel=vinted_guide')).toBeNull();
  });

  it('returns null rather than throwing on an unparseable URL', () => {
    expect(catalogIdFromUrl('not a url')).toBeNull();
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

describe('resolveUseBrowser', () => {
  it('skips the browser for a recognized item page when the site has confirmed it can', () => {
    expect(resolveUseBrowser(true, true, { skip_browser_for_items: true })).toBe(false);
  });

  it('still uses the browser for a non-item (nav/category) page - that is the page whose links get traversed', () => {
    expect(resolveUseBrowser(false, true, { skip_browser_for_items: true })).toBe(true);
  });

  it('leaves the job setting alone when the site has not opted in', () => {
    expect(resolveUseBrowser(true, true, { skip_browser_for_items: false })).toBe(true);
  });

  it('leaves the job setting alone when there is no resolved site at all', () => {
    expect(resolveUseBrowser(true, true, null)).toBe(true);
    expect(resolveUseBrowser(true, undefined, undefined)).toBe(undefined);
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
    vi.doUnmock('../src/services/browser.js');
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

  // The real-world case: several catalog pages crashed Chromium's renderer
  // in a row in production, and every item page fetched afterward hung for
  // the full timeout against that same still-broken, memoized browser
  // instance (services/browser.ts) - nothing ever recycled it. These prove
  // the recovery path fires on the two signals that actually showed up:
  // our own timeout catching a genuine hang, and Chromium's own fatal,
  // page-independent failures.
  it('recycles the shared browser after a genuine hang (our own timeout firing)', async () => {
    const closeBrowser = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../src/lib/scrapeCore.js', () => ({ scrapePage: () => new Promise(() => {}) }));
    vi.doMock('../src/services/browser.js', () => ({ closeBrowser }));

    const { scrapePageWithTimeout, PAGE_TIMEOUT_MS } = await import('../src/workers/crawlWorker.js');
    const promise = scrapePageWithTimeout('https://example.com/stuck', {}, null);
    await vi.advanceTimersByTimeAsync(PAGE_TIMEOUT_MS);
    await promise;

    expect(closeBrowser).toHaveBeenCalled();
  });

  it('recycles the shared browser when Chromium itself reports a fatal, page-independent failure', async () => {
    const closeBrowser = vi.fn().mockResolvedValue(undefined);
    const crashedResult = {
      success: false,
      error: 'page.goto: Page crashed',
      metadata: { sourceURL: 'https://example.com', statusCode: 0 },
    };
    vi.doMock('../src/lib/scrapeCore.js', () => ({ scrapePage: async () => crashedResult }));
    vi.doMock('../src/services/browser.js', () => ({ closeBrowser }));

    const { scrapePageWithTimeout } = await import('../src/workers/crawlWorker.js');
    await scrapePageWithTimeout('https://example.com', {}, null);

    expect(closeBrowser).toHaveBeenCalled();
  });

  it('never recycles the browser for an ordinary failure - the browser itself is fine', async () => {
    const closeBrowser = vi.fn().mockResolvedValue(undefined);
    const ordinaryFailure = {
      success: false,
      error: 'Disallowed by robots.txt',
      metadata: { sourceURL: 'https://example.com', statusCode: 999 },
    };
    vi.doMock('../src/lib/scrapeCore.js', () => ({ scrapePage: async () => ordinaryFailure }));
    vi.doMock('../src/services/browser.js', () => ({ closeBrowser }));

    const { scrapePageWithTimeout } = await import('../src/workers/crawlWorker.js');
    await scrapePageWithTimeout('https://example.com', {}, null);

    expect(closeBrowser).not.toHaveBeenCalled();
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
