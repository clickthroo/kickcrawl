import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isNewSale } from '../src/workers/recheckWorker.js';
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

describe('recheckSite', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.doUnmock('../src/db.js');
    vi.doUnmock('../src/lib/scrapeCore.js');
    vi.doUnmock('../src/lib/urlStore.js');
    vi.doUnmock('../src/lib/persistResult.js');
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
    const progress = { checked: 0, total: 0, sales: 0, errors: [] as string[] };
    await recheckSite(baseSite, 'job-1', {}, progress);

    expect(query).toHaveBeenCalledWith('DELETE FROM urls WHERE id = $1', [recheckableItem.id]);
    expect(markUrlFetched).not.toHaveBeenCalled();
    expect(persistScrapeResult).not.toHaveBeenCalled();
    expect(progress.checked).toBe(1);
    expect(progress.errors).toEqual([]);
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
    const progress = { checked: 0, total: 0, sales: 0, errors: [] as string[] };
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
    const progress = { checked: 0, total: 0, sales: 0, errors: [] as string[] };
    await recheckSite(baseSite, 'job-1', {}, progress);

    expect(query).not.toHaveBeenCalledWith('DELETE FROM urls WHERE id = $1', [recheckableItem.id]);
    expect(markUrlFetched).toHaveBeenCalledWith(baseSite.id, recheckableItem.url, 200, undefined);
    expect(persistScrapeResult).toHaveBeenCalled();
  });
});
