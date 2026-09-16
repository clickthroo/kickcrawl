import { describe, expect, it } from 'vitest';
import { filterCrawlableLinks } from '../src/workers/crawlWorker.js';

describe('filterCrawlableLinks', () => {
  it('drops already-visited links', () => {
    const visited = new Set(['https://example.com/products/1']);
    const result = filterCrawlableLinks(
      ['https://example.com/products/1', 'https://example.com/products/2'],
      visited,
      [],
      [],
    );
    expect(result).toEqual(['https://example.com/products/2']);
  });

  it('keeps only links matching allowed_paths - the real-world repro (Cult Kits, allowed_paths ["/products"])', () => {
    const links = [
      'https://cultkits.com/products/some-shirt',
      'https://cultkits.com/pages/subscribers-email-discount',
      'https://cultkits.com/pages/the-football-shirt-pod',
      'https://cultkits.com/pages/join-the-affiliate-program',
    ];
    // "/products" (no wildcard) only matches that exact path - this test
    // documents that behavior, not "/products/some-shirt" too. The main
    // point here is that the /pages/* marketing links never show up at
    // all, matching what the allow-list is meant to scope out.
    const result = filterCrawlableLinks(links, new Set(), ['/products'], []);
    expect(result).toEqual([]);
  });

  it('a wildcard allowed_paths pattern keeps matching product pages and drops the rest', () => {
    const links = [
      'https://cultkits.com/products/some-shirt',
      'https://cultkits.com/pages/subscribers-email-discount',
    ];
    const result = filterCrawlableLinks(links, new Set(), ['/products/*'], []);
    expect(result).toEqual(['https://cultkits.com/products/some-shirt']);
  });

  it('denied_paths excludes matching links even with no allow-list set', () => {
    const links = ['https://example.com/products/1', 'https://example.com/admin/secret'];
    const result = filterCrawlableLinks(links, new Set(), [], ['/admin/*']);
    expect(result).toEqual(['https://example.com/products/1']);
  });

  it('keeps everything when no allow/deny paths are configured', () => {
    const links = ['https://example.com/anything', 'https://example.com/whatever'];
    const result = filterCrawlableLinks(links, new Set(), [], []);
    expect(result).toEqual(links);
  });
});
