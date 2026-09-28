import { describe, expect, it } from 'vitest';
import { withQueryParam, stripQueryParam } from '../src/lib/queryParams.js';

describe('withQueryParam', () => {
  it('adds a query param to a URL with none', () => {
    expect(withQueryParam('https://example.com/products/foo', 'currency', 'GBP')).toBe(
      'https://example.com/products/foo?currency=GBP',
    );
  });

  it('adds alongside an existing, different query param', () => {
    expect(withQueryParam('https://example.com/products/foo?ref=abc', 'currency', 'GBP')).toBe(
      'https://example.com/products/foo?ref=abc&currency=GBP',
    );
  });

  it('replaces an existing value for the same key rather than duplicating it', () => {
    expect(withQueryParam('https://example.com/products/foo?currency=USD', 'currency', 'GBP')).toBe(
      'https://example.com/products/foo?currency=GBP',
    );
  });
});

describe('stripQueryParam', () => {
  it('removes the only query param, dropping the trailing "?" entirely', () => {
    expect(stripQueryParam('https://example.com/products/foo?currency=GBP', 'currency')).toBe(
      'https://example.com/products/foo',
    );
  });

  it('removes just the one key, leaving other params intact', () => {
    expect(stripQueryParam('https://example.com/products/foo?ref=abc&currency=GBP', 'currency')).toBe(
      'https://example.com/products/foo?ref=abc',
    );
  });

  it('is a no-op when the key is not present', () => {
    expect(stripQueryParam('https://example.com/products/foo?ref=abc', 'currency')).toBe(
      'https://example.com/products/foo?ref=abc',
    );
  });
});
