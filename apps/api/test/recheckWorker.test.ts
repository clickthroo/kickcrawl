import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isNewSale,
  isPriceChange,
  isUnchangedSinceLastCheck,
  runWithConcurrency,
  shouldForceRefetch,
} from '../src/workers/recheckWorker.js';
import type { SiteConfig } from '../src/lib/siteResolver.js';

describe('isNewSale', () => {
  it('is a sale only on the exact In Stock -> Out of Stock transition', () => {
    expect(isNewSale('In Stock', 'Out of Stock')).toBe(true);
  });

  it('is not a sale when it was already out of stock last time - not a new event', () => {
    expect(isNewSale('Out of Stock', 'Out of Stock')).toBe(false);
  });

  it('is not a sale when it stays in stock', () => {
    expect(isNewSale('In Stock', 'In Stock')).toBe(false);
  });

  it('is not a sale when it comes back in stock (a restock, not a sale)', () => {
    expect(isNewSale('Out of Stock', 'In Stock')).toBe(false);
  });

  it('is not a sale from an unknown previous status - no confident "was in stock" to transition from', () => {
    expect(isNewSale('Unknown', 'Out of Stock')).toBe(false);
    expect(isNewSale(null, 'Out of Stock')).toBe(false);
  });

  it('is not a sale when the new status is unknown or null - nothing confidently confirms it sold', () => {
    expect(isNewSale('In Stock', 'Unknown')).toBe(false);
    expect(isNewSale('In Stock', null)).toBe(false);
  });
});

describe('isPriceChange', () => {
  it('ignores a small move that is just currency-conversion rounding noise', () => {
    expect(isPriceChange(50, 'GBP', 50.1, 'GBP')).toBe(false);
  });

  it('ignores the exact £0.75 move seen for real in production - a flat delta independent of the item price is a shared conversion-rate wobble, not real per-item markdowns', () => {
    expect(isPriceChange(72, 'GBP', 71.25, 'GBP')).toBe(false);
    expect(isPriceChange(43.5, 'GBP', 42.75, 'GBP')).toBe(false);
  });

  it('counts a move of at least £2 on a cheap item', () => {
    expect(isPriceChange(20, 'GBP', 22.01, 'GBP')).toBe(true);
    expect(isPriceChange(20, 'GBP', 21.99, 'GBP')).toBe(false);
  });

  it('counts a move of at least 2% on an expensive item, since £2 alone would be too sensitive there', () => {
    expect(isPriceChange(500, 'GBP', 510, 'GBP')).toBe(true); // exactly 2%
    expect(isPriceChange(500, 'GBP', 509, 'GBP')).toBe(false); // 1.8%, under both thresholds
  });

  it('counts a price drop the same as a price rise', () => {
    expect(isPriceChange(100, 'GBP', 50, 'GBP')).toBe(true);
  });

  it('is not a price change when either side has no real price to compare', () => {
    expect(isPriceChange(null, 'GBP', 50, 'GBP')).toBe(false);
    expect(isPriceChange(50, 'GBP', null, 'GBP')).toBe(false);
    expect(isPriceChange(null, null, null, null)).toBe(false);
  });

  it('is not a price change when the currency itself differs - a different kind of event, not this one', () => {
    expect(isPriceChange(50, 'GBP', 50, 'USD')).toBe(false);
  });
});

describe('isUnchangedSinceLastCheck', () => {
  it('is unchanged when the stored value matches what the sitemap currently reports', () => {
    expect(isUnchangedSinceLastCheck('2026-09-20T10:00:00Z', '2026-09-20T10:00:00Z')).toBe(true);
  });

  it('is changed when the sitemap now reports a different lastmod', () => {
    expect(isUnchangedSinceLastCheck('2026-09-20T10:00:00Z', '2026-09-21T10:00:00Z')).toBe(false);
  });

  it('is never unchanged with nothing stored yet - a url checked for the first time always gets a real fetch', () => {
    expect(isUnchangedSinceLastCheck(null, '2026-09-20T10:00:00Z')).toBe(false);
  });

  it('is never unchanged when the url is missing from the sitemap right now - the safe fallback, not a false positive', () => {
    expect(isUnchangedSinceLastCheck('2026-09-20T10:00:00Z', undefined)).toBe(false);
    expect(isUnchangedSinceLastCheck('2026-09-20T10:00:00Z', null)).toBe(false);
  });

  it('is never unchanged with nothing on either side - a site with no sitemap at all always falls through to a real fetch', () => {
    expect(isUnchangedSinceLastCheck(null, undefined)).toBe(false);
  });
});

describe('shouldForceRefetch', () => {
  it('forces a refetch when nothing has ever been fetched', () => {
    expect(shouldForceRefetch(null, new Date('2026-09-26T00:00:00Z'), 24)).toBe(true);
  });

  it('does not force a refetch when the last fetch is well within the window', () => {
    expect(shouldForceRefetch('2026-09-25T12:00:00Z', new Date('2026-09-26T00:00:00Z'), 24)).toBe(false);
  });

  it('forces a refetch once the last fetch is at least the full window old', () => {
    expect(shouldForceRefetch('2026-09-25T00:00:00Z', new Date('2026-09-26T00:00:00Z'), 24)).toBe(true);
  });

  it('forces a refetch well past the window, not just at the boundary', () => {
    expect(shouldForceRefetch('2026-09-01T00:00:00Z', new Date('2026-09-26T00:00:00Z'), 24)).toBe(true);
  });
});

describe('runWithConcurrency', () => {
  it('runs every item exactly once', async () => {
    const seen: number[] = [];
    await runWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      seen.push(n);
    });
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('never exceeds the concurrency cap', async () => {
    let active = 0;
    let maxActive = 0;
    await runWithConcurrency([1, 2, 3, 4, 5, 6], 2, async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
    });
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('does not let one slow item hold up the others - the exact VFS-blocking-every-other-site bug this replaces', async () => {
    const finishOrder: string[] = [];
    const items = [
      { name: 'slow-site', delayMs: 30 },
      { name: 'fast-site-a', delayMs: 1 },
      { name: 'fast-site-b', delayMs: 1 },
    ];
    await runWithConcurrency(items, 3, async (item) => {
      await new Promise((resolve) => setTimeout(resolve, item.delayMs));
      finishOrder.push(item.name);
    });
    // Both fast sites finish well before the slow one, instead of queuing
    // behind it as the old sequential for-loop would have forced.
    expect(finishOrder.slice(0, 2).sort()).toEqual(['fast-site-a', 'fast-site-b']);
    expect(finishOrder[2]).toBe('slow-site');
  });

  it('handles fewer items than the concurrency limit without error', async () => {
    const seen: number[] = [];
    await runWithConcurrency([1], 3, async (n) => {
      seen.push(n);
    });
    expect(seen).toEqual([1]);
  });

  it('handles an empty list', async () => {
    const seen: number[] = [];
    await runWithConcurrency([], 3, async (n: number) => {
      seen.push(n);
    });
    expect(seen).toEqual([]);
  });
});

describe('recheckSite', () => {
  beforeEach(() => {
    vi.resetModules();
    // Every test here is about the fetch/detection path, not the sitemap-
    // lastmod skip specifically (that has its own describe block below) -
    // an empty sitemap is the same as "no lastmod data available", which
    // makes isUnchangedSinceLastCheck always false and every item fall
    // through to a real fetch, identical to how these tests behaved before
    // that optimization existed. Mocked at this shared level (rather than
    // in each test) mainly so nothing here ever attempts a real network
    // fetch against baseSite's real https://www.vinted.co.uk.
    vi.doMock('../src/services/sitemap.js', () => ({ getAllSitemapEntries: vi.fn(async () => []) }));
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.doUnmock('../src/db.js');
    vi.doUnmock('../src/lib/scrapeCore.js');
    vi.doUnmock('../src/lib/urlStore.js');
    vi.doUnmock('../src/lib/persistResult.js');
    vi.doUnmock('../src/services/sitemap.js');
  });

  const baseSite: SiteConfig = {
    id: 'site-1',
    name: 'Vinted',
    base_url: 'https://www.vinted.co.uk',
    rate_limit_rps: 1,
    max_depth: 3,
    use_browser_default: false,
    skip_browser_for_items: false,
    use_proxy: false,
    default_selectors: {},
    allowed_paths: ['/items/*'],
    denied_paths: [],
    is_active: true,
    require_pro_seller: true,
    min_seller_feedback: null,
  };

  const recheckableItem = {
    id: 'url-1',
    url: 'https://www.vinted.co.uk/items/1-sheffield-wednesday-training-top',
    path: '/items/1-sheffield-wednesday-training-top',
    stock_status: 'In Stock',
  };

  it('drops an item that no longer passes the site\'s seller filter instead of refreshing it', async () => {
    // Real production case: a non-Pro seller's item ("juliewhittaker",
    // recorded before "Pro only" was turned on) kept being refreshed by
    // every recheck forever, because recheckSite only ever updated
    // stock/price and never re-checked the seller filter.
    const query = vi.fn().mockResolvedValue({ rows: [recheckableItem] });
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/lib/scrapeCore.js', () => ({
      scrapePage: async () => ({
        success: true,
        markdown: '[juliewhittaker](https://www.vinted.co.uk/member/96669517)\n[86](https://www.vinted.co.uk/member/96669517)\nFrequent Uploads',
        metadata: { sourceURL: recheckableItem.url, statusCode: 200 },
      }),
    }));
    const markUrlFetched = vi.fn();
    const persistScrapeResult = vi.fn();
    vi.doMock('../src/lib/urlStore.js', () => ({ markUrlFetched }));
    vi.doMock('../src/lib/persistResult.js', () => ({ persistScrapeResult }));

    const { recheckSite } = await import('../src/workers/recheckWorker.js');
    const progress = { checked: 0, total: 0, sales: 0, priceChanges: 0, skippedViaSitemap: 0, errors: [] as string[] };
    await recheckSite(baseSite, 'job-1', {}, progress);

    expect(query).toHaveBeenCalledWith('DELETE FROM urls WHERE id = $1', [recheckableItem.id]);
    expect(markUrlFetched).not.toHaveBeenCalled();
    expect(persistScrapeResult).not.toHaveBeenCalled();
    expect(progress.checked).toBe(1);
    expect(progress.errors).toEqual([]);
  });

  it('excludes items already known Out of Stock from the recheck query - once sold, stays sold - but includes status=failed items with a known reading', async () => {
    // Once an item has been recorded as sold, there's nothing left for an
    // hourly recheck to catch by revisiting it forever - excluded at the
    // query itself so it's never fetched at all, not just skipped after.
    // status='failed' rows ARE included now (as long as they have a real
    // stock_status to diff from) - confirmed in production that 78% of
    // everything with a known non-Out-of-Stock stock_status sat in
    // status='failed' (its last fetch attempt errored) and was being
    // permanently excluded from ever being re-verified, which meant a
    // real sale on any of them could never be detected.
    const query = vi.fn().mockResolvedValue({ rows: [] });
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/lib/scrapeCore.js', () => ({ scrapePage: vi.fn() }));
    vi.doMock('../src/lib/urlStore.js', () => ({ markUrlFetched: vi.fn() }));
    vi.doMock('../src/lib/persistResult.js', () => ({ persistScrapeResult: vi.fn() }));

    const { recheckSite } = await import('../src/workers/recheckWorker.js');
    const progress = { checked: 0, total: 0, sales: 0, priceChanges: 0, skippedViaSitemap: 0, errors: [] as string[] };
    await recheckSite(baseSite, 'job-1', {}, progress);

    const [selectSql] = query.mock.calls[0];
    expect(selectSql).toMatch(/status = 'fetched'/);
    expect(selectSql).toMatch(/status = 'failed'/);
    expect(selectSql).toMatch(/stock_status IS NOT NULL/);
    expect(selectSql).toMatch(/stock_status != 'Out of Stock'/);
  });

  it('gates status=failed rows behind a backoff, so retrying them cannot balloon a single recheck pass past its own hourly interval', async () => {
    // Confirmed in production: including all ~5000 'failed' rows
    // unconditionally on every cycle grew one recheck pass past 5 hours,
    // collapsing the real detection cadence for the WHOLE catalog (fetched
    // rows included) from hourly to roughly once every 5-6 hours - "no
    // sales or price changes for most of the day" traced back to this, not
    // to the comparison logic itself.
    const query = vi.fn().mockResolvedValue({ rows: [] });
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/lib/scrapeCore.js', () => ({ scrapePage: vi.fn() }));
    vi.doMock('../src/lib/urlStore.js', () => ({ markUrlFetched: vi.fn() }));
    vi.doMock('../src/lib/persistResult.js', () => ({ persistScrapeResult: vi.fn() }));

    const { recheckSite } = await import('../src/workers/recheckWorker.js');
    const progress = { checked: 0, total: 0, sales: 0, priceChanges: 0, skippedViaSitemap: 0, errors: [] as string[] };
    await recheckSite(baseSite, 'job-1', {}, progress);

    const [selectSql] = query.mock.calls[0];
    expect(selectSql).toMatch(/status = 'failed' AND last_fetched_at < now\(\) - interval '\d+ hours'/);
    // A 'fetched' row is never gated by this - only the failed backlog.
    expect(selectSql).not.toMatch(/status = 'fetched' AND last_fetched_at/);
  });

  it('records the full Kickio profile on a sale, not just title/price/currency', async () => {
    // No seller filter configured (unlike baseSite) - this exercises a
    // plain retailer, not a marketplace where a seller's own Pro/feedback
    // signal would also need to be present in the markdown to pass.
    const siteWithoutSellerFilter: SiteConfig = { ...baseSite, require_pro_seller: false, min_seller_feedback: null };
    const soldItem = { ...recheckableItem, stock_status: 'In Stock' };
    const query = vi.fn().mockResolvedValue({ rows: [soldItem] });
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/lib/scrapeCore.js', () => ({
      scrapePage: async () => ({
        success: true,
        markdown: '£25 Sold out',
        metadata: { sourceURL: soldItem.url, statusCode: 200, title: '1998 France Home Shirt', image: null },
        extracted: {},
      }),
    }));
    vi.doMock('../src/lib/urlStore.js', () => ({ markUrlFetched: vi.fn().mockResolvedValue(soldItem.id) }));
    vi.doMock('../src/lib/persistResult.js', () => ({ persistScrapeResult: vi.fn() }));

    const { recheckSite } = await import('../src/workers/recheckWorker.js');
    const progress = { checked: 0, total: 0, sales: 0, priceChanges: 0, skippedViaSitemap: 0, errors: [] as string[] };
    await recheckSite(siteWithoutSellerFilter, 'job-1', {}, progress);

    expect(progress.sales).toBe(1);
    const saleCall = query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO sales'));
    expect(saleCall).toBeDefined();
    const [, params] = saleCall!;
    expect(params[0]).toBe(soldItem.id);
    expect(params[1]).toBe(siteWithoutSellerFilter.id);
    expect(params[2]).toBe('1998 France Home Shirt');
    expect(params[3]).toBe(25);
    expect(params[4]).toBe('GBP');
    const profile = JSON.parse(params[5]);
    expect(profile.identity.team).toBe('France');
    expect(profile.listing.stock_status).toBe('Out of Stock');
  });

  it('records a price change on a real move, with the full profile snapshot - mirrors the sale detection above', async () => {
    const siteWithoutSellerFilter: SiteConfig = { ...baseSite, require_pro_seller: false, min_seller_feedback: null };
    const item = { ...recheckableItem, stock_status: 'In Stock', price: 90, currency: 'GBP' };
    const query = vi.fn().mockResolvedValue({ rows: [item] });
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/lib/scrapeCore.js', () => ({
      scrapePage: async () => ({
        success: true,
        markdown: 'Add to Bag',
        metadata: { sourceURL: item.url, statusCode: 200, title: '1998 France Home Shirt', image: null },
        extracted: { price: '£75.00' },
      }),
    }));
    vi.doMock('../src/lib/urlStore.js', () => ({ markUrlFetched: vi.fn().mockResolvedValue(item.id) }));
    vi.doMock('../src/lib/persistResult.js', () => ({ persistScrapeResult: vi.fn() }));

    const { recheckSite } = await import('../src/workers/recheckWorker.js');
    const progress = { checked: 0, total: 0, sales: 0, priceChanges: 0, skippedViaSitemap: 0, errors: [] as string[] };
    await recheckSite(siteWithoutSellerFilter, 'job-1', {}, progress);

    expect(progress.priceChanges).toBe(1);
    const priceChangeCall = query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO price_changes'));
    expect(priceChangeCall).toBeDefined();
    const [, params] = priceChangeCall!;
    expect(params[0]).toBe(item.id);
    expect(params[1]).toBe(siteWithoutSellerFilter.id);
    expect(params[2]).toBe('1998 France Home Shirt');
    expect(params[3]).toBe(90); // old_price - from the stored urls row
    expect(params[4]).toBe(75); // new_price - from this recheck's fresh scrape
    expect(params[5]).toBe('GBP');
    const profile = JSON.parse(params[6]);
    expect(profile.listing.price).toBe(75);
  });

  it('does not record a price change under the noise threshold, or when nothing changed', async () => {
    const siteWithoutSellerFilter: SiteConfig = { ...baseSite, require_pro_seller: false, min_seller_feedback: null };
    const item = { ...recheckableItem, stock_status: 'In Stock', price: 90, currency: 'GBP' };
    const query = vi.fn().mockResolvedValue({ rows: [item] });
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/lib/scrapeCore.js', () => ({
      scrapePage: async () => ({
        success: true,
        markdown: 'Add to Bag',
        metadata: { sourceURL: item.url, statusCode: 200, title: '1998 France Home Shirt', image: null },
        extracted: { price: '£90.20' }, // a 20p wobble - under the £2/2% threshold
      }),
    }));
    vi.doMock('../src/lib/urlStore.js', () => ({ markUrlFetched: vi.fn().mockResolvedValue(item.id) }));
    vi.doMock('../src/lib/persistResult.js', () => ({ persistScrapeResult: vi.fn() }));

    const { recheckSite } = await import('../src/workers/recheckWorker.js');
    const progress = { checked: 0, total: 0, sales: 0, priceChanges: 0, skippedViaSitemap: 0, errors: [] as string[] };
    await recheckSite(siteWithoutSellerFilter, 'job-1', {}, progress);

    expect(progress.priceChanges).toBe(0);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO price_changes'))).toBe(false);
  });

  it('persists the full profile (team, season, colour, size, ...) on every recheck, not just stock_status', async () => {
    // The admin Items list now filters these fields in SQL (routes/admin/
    // urls.ts) instead of building a profile for every row on every
    // request - a recheck is one of the places that data has to actually
    // get written for that to work.
    const siteWithoutSellerFilter: SiteConfig = { ...baseSite, require_pro_seller: false, min_seller_feedback: null };
    const query = vi.fn().mockResolvedValue({ rows: [recheckableItem] });
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/lib/scrapeCore.js', () => ({
      scrapePage: async () => ({
        success: true,
        markdown: 'Add to Bag',
        metadata: { sourceURL: recheckableItem.url, statusCode: 200, title: '2019-20 Arsenal Adidas Away Shirt M', image: null },
        extracted: {},
      }),
    }));
    vi.doMock('../src/lib/urlStore.js', () => ({ markUrlFetched: vi.fn().mockResolvedValue(recheckableItem.id) }));
    vi.doMock('../src/lib/persistResult.js', () => ({ persistScrapeResult: vi.fn() }));

    const { recheckSite } = await import('../src/workers/recheckWorker.js');
    const progress = { checked: 0, total: 0, sales: 0, priceChanges: 0, skippedViaSitemap: 0, errors: [] as string[] };
    await recheckSite(siteWithoutSellerFilter, 'job-1', {}, progress);

    const updateCall = query.mock.calls.find(([sql]) => String(sql).includes('UPDATE urls SET'));
    expect(updateCall).toBeDefined();
    const [sql, params] = updateCall!;
    expect(String(sql)).toContain('team');
    expect(String(sql)).toContain('colour');
    expect(params[0]).toBe(recheckableItem.id);
    expect(params).toContain('Arsenal');
    expect(params).toContain('M');
  });

  it('keeps refreshing an item that still passes the seller filter, same as before', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [recheckableItem] });
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/lib/scrapeCore.js', () => ({
      scrapePage: async () => ({
        success: true,
        markdown: '[RB Shirts](https://www.vinted.co.uk/member/1)\n[2263](https://www.vinted.co.uk/member/1)\nPro',
        metadata: { sourceURL: recheckableItem.url, statusCode: 200, title: 'Sheffield Wednesday shirt' },
        extracted: {},
      }),
    }));
    const markUrlFetched = vi.fn().mockResolvedValue(recheckableItem.id);
    const persistScrapeResult = vi.fn();
    vi.doMock('../src/lib/urlStore.js', () => ({ markUrlFetched }));
    vi.doMock('../src/lib/persistResult.js', () => ({ persistScrapeResult }));

    const { recheckSite } = await import('../src/workers/recheckWorker.js');
    const progress = { checked: 0, total: 0, sales: 0, priceChanges: 0, skippedViaSitemap: 0, errors: [] as string[] };
    await recheckSite(baseSite, 'job-1', {}, progress);

    expect(query).not.toHaveBeenCalledWith('DELETE FROM urls WHERE id = $1', [recheckableItem.id]);
    expect(markUrlFetched).toHaveBeenCalledWith(baseSite.id, recheckableItem.url, 200, undefined);
    expect(persistScrapeResult).toHaveBeenCalled();
  });

  it('skips the real fetch entirely when the sitemap reports the same lastmod stored from the last check', async () => {
    // The actual point of this whole feature: no scrapePage call, no
    // markUrlFetched, no persistScrapeResult - just counted as checked.
    // last_fetched_at is recent, so the force-refetch safety net (below)
    // doesn't kick in and mask what this test is actually checking.
    const unchangedItem = {
      ...recheckableItem,
      sitemap_lastmod: '2026-09-20T10:00:00Z',
      last_fetched_at: new Date().toISOString(),
    };
    const query = vi.fn().mockResolvedValue({ rows: [unchangedItem] });
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/services/sitemap.js', () => ({
      getAllSitemapEntries: vi.fn(async () => [{ loc: unchangedItem.url, lastmod: '2026-09-20T10:00:00Z' }]),
    }));
    const scrapePage = vi.fn();
    const markUrlFetched = vi.fn();
    const persistScrapeResult = vi.fn();
    vi.doMock('../src/lib/scrapeCore.js', () => ({ scrapePage }));
    vi.doMock('../src/lib/urlStore.js', () => ({ markUrlFetched }));
    vi.doMock('../src/lib/persistResult.js', () => ({ persistScrapeResult }));

    const { recheckSite } = await import('../src/workers/recheckWorker.js');
    const progress = { checked: 0, total: 0, sales: 0, priceChanges: 0, skippedViaSitemap: 0, errors: [] as string[] };
    await recheckSite(baseSite, 'job-1', {}, progress);

    expect(scrapePage).not.toHaveBeenCalled();
    expect(markUrlFetched).not.toHaveBeenCalled();
    expect(persistScrapeResult).not.toHaveBeenCalled();
    expect(progress.checked).toBe(1);
    expect(progress.skippedViaSitemap).toBe(1);
  });

  it('still fetches for real once a day even when the sitemap keeps reporting the same lastmod - the safety net for sites whose sitemap never reflects a stock change', async () => {
    // Same matching-lastmod setup as the "skips the real fetch" test above,
    // but last_fetched_at is over 24h old - a sold item whose listing markup
    // never changed still needs to be caught eventually, not skipped forever.
    const staleItem = {
      ...recheckableItem,
      sitemap_lastmod: '2026-09-20T10:00:00Z',
      last_fetched_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    };
    const query = vi.fn().mockResolvedValue({ rows: [staleItem] });
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/services/sitemap.js', () => ({
      getAllSitemapEntries: vi.fn(async () => [{ loc: staleItem.url, lastmod: '2026-09-20T10:00:00Z' }]),
    }));
    const scrapePage = vi.fn(async () => ({
      success: true,
      markdown: '[RB Shirts](https://www.vinted.co.uk/member/1)\n[2263](https://www.vinted.co.uk/member/1)\nPro',
      metadata: { sourceURL: staleItem.url, statusCode: 200, title: 'Sheffield Wednesday shirt', image: null },
      extracted: {},
    }));
    vi.doMock('../src/lib/scrapeCore.js', () => ({ scrapePage }));
    vi.doMock('../src/lib/urlStore.js', () => ({ markUrlFetched: vi.fn().mockResolvedValue(staleItem.id) }));
    vi.doMock('../src/lib/persistResult.js', () => ({ persistScrapeResult: vi.fn() }));

    const { recheckSite } = await import('../src/workers/recheckWorker.js');
    const progress = { checked: 0, total: 0, sales: 0, priceChanges: 0, skippedViaSitemap: 0, errors: [] as string[] };
    await recheckSite(baseSite, 'job-1', {}, progress);

    expect(scrapePage).toHaveBeenCalledOnce();
    expect(progress.skippedViaSitemap).toBe(0);
  });

  it('fetches for real and records the new lastmod when the sitemap reports a change since the last check', async () => {
    const changedItem = { ...recheckableItem, sitemap_lastmod: '2026-09-20T10:00:00Z' };
    const query = vi.fn().mockResolvedValue({ rows: [changedItem] });
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/services/sitemap.js', () => ({
      // A newer lastmod than what's stored - must NOT be treated as unchanged.
      getAllSitemapEntries: vi.fn(async () => [{ loc: changedItem.url, lastmod: '2026-09-25T10:00:00Z' }]),
    }));
    const scrapePage = vi.fn(async () => ({
      success: true,
      markdown: 'Add to Bag',
      metadata: { sourceURL: changedItem.url, statusCode: 200, title: 'Sheffield Wednesday shirt', image: null },
      extracted: {},
    }));
    vi.doMock('../src/lib/scrapeCore.js', () => ({ scrapePage }));
    vi.doMock('../src/lib/urlStore.js', () => ({ markUrlFetched: vi.fn().mockResolvedValue(changedItem.id) }));
    vi.doMock('../src/lib/persistResult.js', () => ({ persistScrapeResult: vi.fn() }));

    const { recheckSite } = await import('../src/workers/recheckWorker.js');
    const progress = { checked: 0, total: 0, sales: 0, priceChanges: 0, skippedViaSitemap: 0, errors: [] as string[] };
    await recheckSite({ ...baseSite, require_pro_seller: false }, 'job-1', {}, progress);

    expect(scrapePage).toHaveBeenCalledOnce();
    expect(progress.skippedViaSitemap).toBe(0);
    const lastmodCall = query.mock.calls.find(([sql]) => String(sql).includes('sitemap_lastmod = $2'));
    expect(lastmodCall).toBeDefined();
    expect(lastmodCall![1]).toEqual([changedItem.id, '2026-09-25T10:00:00Z']);
  });
});

describe('scheduleRecheck', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.doUnmock('../src/queue.js');
  });

  it('removes every existing "recheck" repeatable schedule before adding the current one, instead of stacking a second schedule alongside it', async () => {
    // BullMQ keys a repeatable job by name + repeat options (including the
    // interval), so simply changing RECHECK_INTERVAL_MS and redeploying
    // would otherwise leave whatever schedule a previous deploy registered
    // (e.g. every 4 hours) running forever alongside the new one (e.g.
    // every hour) - two overlapping recheck cycles, not one replaced by
    // the other.
    const getRepeatableJobs = vi.fn().mockResolvedValue([
      { key: 'recheck::old-4h-key', name: 'recheck', every: '14400000' },
      { key: 'other-queue-job::key', name: 'something-else', every: '60000' },
    ]);
    const removeRepeatableByKey = vi.fn().mockResolvedValue(undefined);
    const add = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../src/queue.js', () => ({
      redisConnection: {},
      recheckQueue: { getRepeatableJobs, removeRepeatableByKey, add },
    }));

    const { scheduleRecheck, RECHECK_INTERVAL_MS } = await import('../src/workers/recheckWorker.js');
    await scheduleRecheck();

    expect(removeRepeatableByKey).toHaveBeenCalledTimes(1);
    expect(removeRepeatableByKey).toHaveBeenCalledWith('recheck::old-4h-key');
    expect(add).toHaveBeenCalledWith('recheck', {}, { repeat: { every: RECHECK_INTERVAL_MS } });
  });

  it('adds the schedule even when there is nothing existing to remove - the first-ever boot case', async () => {
    const getRepeatableJobs = vi.fn().mockResolvedValue([]);
    const removeRepeatableByKey = vi.fn();
    const add = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../src/queue.js', () => ({
      redisConnection: {},
      recheckQueue: { getRepeatableJobs, removeRepeatableByKey, add },
    }));

    const { scheduleRecheck } = await import('../src/workers/recheckWorker.js');
    await scheduleRecheck();

    expect(removeRepeatableByKey).not.toHaveBeenCalled();
    expect(add).toHaveBeenCalledTimes(1);
  });
});
