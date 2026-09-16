import { describe, expect, it } from 'vitest';
import { filterTraversableLinks, isCrawlItem } from '../src/workers/crawlWorker.js';

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
