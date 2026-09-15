import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';
import { extractLinks, isPathAllowed, isSameSite, matchesPathPattern } from '../src/services/links.js';

describe('extractLinks', () => {
  it('resolves relative links to absolute URLs and dedupes', () => {
    const html = `
      <a href="/shirt/1">A</a>
      <a href="/shirt/1">A again</a>
      <a href="https://other.com/x">B</a>
      <a href="#top">C</a>
      <a href="mailto:test@example.com">D</a>
    `;
    const $ = cheerio.load(html);
    const links = extractLinks($, 'https://example.com/page');
    expect(links).toContain('https://example.com/shirt/1');
    expect(links).toContain('https://other.com/x');
    expect(links).not.toContain('https://example.com/page#top');
    expect(links.some((l) => l.startsWith('mailto:'))).toBe(false);
    expect(links.filter((l) => l === 'https://example.com/shirt/1')).toHaveLength(1);
  });
});

describe('isSameSite', () => {
  it('matches exact hostname', () => {
    expect(isSameSite('https://example.com/a', 'https://example.com', false)).toBe(true);
    expect(isSameSite('https://other.com/a', 'https://example.com', false)).toBe(false);
  });

  it('matches subdomains only when includeSubdomains is true', () => {
    expect(isSameSite('https://shop.example.com/a', 'https://example.com', false)).toBe(false);
    expect(isSameSite('https://shop.example.com/a', 'https://example.com', true)).toBe(true);
  });
});

describe('matchesPathPattern', () => {
  it('supports glob-style wildcards', () => {
    expect(matchesPathPattern('/shirt/123', '/shirt/*')).toBe(true);
    expect(matchesPathPattern('/cart', '/shirt/*')).toBe(false);
    expect(matchesPathPattern('/cart', '/cart')).toBe(true);
  });
});

describe('isPathAllowed', () => {
  it('excludes denied paths even if included', () => {
    expect(isPathAllowed('/cart', ['/*'], ['/cart'])).toBe(false);
  });

  it('requires a match against includePaths when provided', () => {
    expect(isPathAllowed('/shirt/1', ['/shirt/*'], [])).toBe(true);
    expect(isPathAllowed('/blog/1', ['/shirt/*'], [])).toBe(false);
  });

  it('allows everything when no include/exclude patterns are set', () => {
    expect(isPathAllowed('/anything', [], [])).toBe(true);
  });
});
