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

  // Recycling the shared browser (services/browser.ts) on a fatal browser
  // error used to happen here too, checked AFTER scrapePage() had already
  // returned - by which point withBrowserSlot (services/browser.ts) had
  // already released its single app-wide slot, so a different concurrent
  // job (concurrency: 3) could already be mid-fetch on a brand new browser
  // instance that this stale, context-unaware check would then tear down,
  // producing the exact same fatal-looking error and making THAT job
  // recycle too - a self-sustaining storm from one initial crash. That
  // recycling decision now lives solely in fetcher.ts's fetchWithBrowser(),
  // covered by fetcher.test.ts, where it happens while still holding
  // withBrowserSlot's single slot - so it can never race a different job's
  // browser fetch. This test just confirms scrapePageWithTimeout no longer
  // reaches into browser.ts at all.
  it('never touches the shared browser itself - that recycling now lives entirely in fetcher.ts, safely inside its single browser slot', async () => {
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

    expect(closeBrowser).not.toHaveBeenCalled();
  });

  it('retries once after a fatal browser crash, instead of leaving that one page permanently failed', async () => {
    // Real production case: a fresh crawl job's SEED page (depth 0, the
    // only URL queued at that point) hit exactly one Chromium crash - by
    // then already backed off and given a fresh browser instance
    // (fetcher.ts's fetchWithBrowser), so a retry has a real chance of
    // succeeding - and the whole job ended there anyway: zero pages ever
    // fetched, no links ever discovered to try instead, nothing left in
    // queue to fall back to.
    let calls = 0;
    const crashedResult = {
      success: false,
      error: 'browserType.launch: Target page, context or browser has been closed',
      metadata: { sourceURL: 'https://example.com', statusCode: 0 },
    };
    const recoveredResult = { success: true, metadata: { sourceURL: 'https://example.com', statusCode: 200 } };
    vi.doMock('../src/lib/scrapeCore.js', () => ({
      scrapePage: async () => {
        calls += 1;
        return calls === 1 ? crashedResult : recoveredResult;
      },
    }));

    const { scrapePageWithTimeout } = await import('../src/workers/crawlWorker.js');
    const result = await scrapePageWithTimeout('https://example.com', {}, null);

    expect(calls).toBe(2);
    expect(result).toBe(recoveredResult);
  });

  it('does not retry an ordinary failure - a 404, a real outage, robots.txt - those deserve to fail once and stay failed', async () => {
    let calls = 0;
    const notFound = {
      success: false,
      error: 'Blocked by anti-bot protection (status 404)',
      metadata: { sourceURL: 'https://example.com', statusCode: 404 },
    };
    vi.doMock('../src/lib/scrapeCore.js', () => ({
      scrapePage: async () => {
        calls += 1;
        return notFound;
      },
    }));

    const { scrapePageWithTimeout } = await import('../src/workers/crawlWorker.js');
    const result = await scrapePageWithTimeout('https://example.com', {}, null);

    expect(calls).toBe(1);
    expect(result).toBe(notFound);
  });

  it('gives up after the retry also crashes, rather than retrying forever', async () => {
    let calls = 0;
    const crashedResult = {
      success: false,
      error: 'page.goto: Page crashed',
      metadata: { sourceURL: 'https://example.com', statusCode: 0 },
    };
    vi.doMock('../src/lib/scrapeCore.js', () => ({
      scrapePage: async () => {
        calls += 1;
        return crashedResult;
      },
    }));

    const { scrapePageWithTimeout } = await import('../src/workers/crawlWorker.js');
    const result = await scrapePageWithTimeout('https://example.com', {}, null);

    expect(calls).toBe(2);
    expect(result).toBe(crashedResult);
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

describe('recordItemProfile', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.doUnmock('../src/db.js');
  });

  // Mocks the same '../src/db.js' pool every real query in this path goes
  // through - getPreviousStockAndPrice's own SELECT, persistItemProfile's
  // UPDATE, and (when a transition fires) the INSERT INTO sales/
  // price_changes - so `previous` is exactly what getPreviousStockAndPrice
  // reads back before recordItemProfile overwrites it.
  function mockPool(previous: { stock_status: string | null; price: number | null; currency: string | null }) {
    const query = vi.fn(async (sql: string) => {
      if (String(sql).includes('SELECT stock_status, price, currency FROM urls')) {
        return { rows: [previous] };
      }
      return { rows: [] };
    });
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    return query;
  }

  it('detects a sale when a crawl re-fetch of an already-known item observes an In Stock -> Out of Stock transition', async () => {
    // The real gap this closes: crawlWorker re-fetches already-known
    // urls constantly (confirmed in production - thousands of urls
    // touched by more than one separate crawl job), and until now that
    // overwrote stock_status with no comparison at all, so a transition
    // a crawl happened to be the one to observe was silently lost.
    const query = mockPool({ stock_status: 'In Stock', price: 25, currency: 'GBP' });
    const { recordItemProfile } = await import('../src/workers/crawlWorker.js');

    const outcome = await recordItemProfile(
      'url-1',
      'site-1',
      'https://example.com/products/sold-shirt',
      {
        success: true,
        markdown: '£25 Sold out',
        metadata: { sourceURL: 'https://example.com/products/sold-shirt', statusCode: 200, title: '1998 France Home Shirt', image: null },
        extracted: {},
      },
      {},
      null,
    );

    expect(outcome.sale).toBe(true);
    const saleCall = query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO sales'));
    expect(saleCall).toBeDefined();
    const [, params] = saleCall!;
    expect(params[0]).toBe('url-1');
    expect(params[1]).toBe('site-1');
    expect(params[2]).toBe('1998 France Home Shirt');
  });

  it('records the price it was actually listed at, not a null/missing price from the now-sold-out page - confirmed in production (AC Milan shirt) that the source page stops rendering a price once marked sold out', async () => {
    // Same shape as the real bug: previous read was £45 In Stock, but the
    // fresh Out of Stock page's own markdown has no price at all (no "£"
    // anywhere) - profile.listing.price comes back null for THIS read.
    // The sale should still record £45, the price it was known to be
    // listed/sold at, not null just because the post-sale page lost it.
    const query = mockPool({ stock_status: 'In Stock', price: 45, currency: 'GBP' });
    const { recordItemProfile } = await import('../src/workers/crawlWorker.js');

    const outcome = await recordItemProfile(
      'url-4',
      'site-1',
      'https://example.com/products/ac-milan-shirt',
      {
        success: true,
        // "Sold out" alone on its own paragraph (blank lines either side),
        // no price anywhere - mirrors the real page shape: a Shopify
        // sticky/quick-buy widget's own text, not near the price block at
        // all (which the retailer stops rendering once sold out).
        markdown: 'AC Milan / Mint / XL – [Change](#product-info)\n\nSold out\n\n[Trustpilot](https://example.com/reviews)',
        metadata: { sourceURL: 'https://example.com/products/ac-milan-shirt', statusCode: 200, title: 'AC Milan Home Shirt', image: null },
        extracted: {},
      },
      {},
      null,
    );

    expect(outcome.sale).toBe(true);
    const saleCall = query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO sales'));
    expect(saleCall).toBeDefined();
    const [, params] = saleCall!;
    expect(params[3]).toBe(45); // price - from the PREVIOUS reading, not the now-priceless page
    expect(params[4]).toBe('GBP');
  });

  it('does not detect a sale on a brand new item - nothing to transition from yet', async () => {
    const query = mockPool({ stock_status: null, price: null, currency: null });
    const { recordItemProfile } = await import('../src/workers/crawlWorker.js');

    const outcome = await recordItemProfile(
      'url-2',
      'site-1',
      'https://example.com/products/new-shirt',
      {
        success: true,
        markdown: '£25 Sold out',
        metadata: { sourceURL: 'https://example.com/products/new-shirt', statusCode: 200, title: 'Brand New Item', image: null },
        extracted: {},
      },
      {},
      null,
    );

    expect(outcome.sale).toBe(false);
    expect(query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO sales'))).toBeUndefined();
  });

  it('detects a price change on a crawl re-fetch the same way it detects a sale', async () => {
    const query = mockPool({ stock_status: 'In Stock', price: 90, currency: 'GBP' });
    const { recordItemProfile } = await import('../src/workers/crawlWorker.js');

    const outcome = await recordItemProfile(
      'url-3',
      'site-1',
      'https://example.com/products/discounted-shirt',
      {
        success: true,
        markdown: 'Add to Bag',
        metadata: { sourceURL: 'https://example.com/products/discounted-shirt', statusCode: 200, title: '1998 France Home Shirt', image: null },
        extracted: { price: '£75.00' },
      },
      {},
      null,
    );

    expect(outcome.priceChange).toBe(true);
    const priceChangeCall = query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO price_changes'));
    expect(priceChangeCall).toBeDefined();
    const [, params] = priceChangeCall!;
    expect(params[3]).toBe(90); // old_price
    expect(params[4]).toBe(75); // new_price
  });
});
