import { describe, expect, it } from 'vitest';
import { extractBySelectors } from '../src/services/extractor.js';

describe('extractBySelectors', () => {
  const html = `
    <html><body>
      <h1 class="title">1990-91 Manchester United Home Shirt</h1>
      <span class="price">£49.99</span>
      <meta name="size" content="L" />
    </body></html>
  `;

  it('extracts text content by CSS selector', () => {
    const result = extractBySelectors(html, { title: 'h1.title', price: '.price' });
    expect(result.title).toBe('1990-91 Manchester United Home Shirt');
    expect(result.price).toBe('£49.99');
  });

  it('reads meta tag content attribute when the selector points at a meta tag', () => {
    const result = extractBySelectors(html, { size: 'meta[name="size"]' });
    expect(result.size).toBe('L');
  });

  it('skips fields whose selector matches nothing', () => {
    const result = extractBySelectors(html, { missing: '.does-not-exist' });
    expect(result.missing).toBeUndefined();
  });

  it('reads an <img> selector by its src attribute, resolved to an absolute URL', () => {
    const imgHtml = '<html><body><img class="photo" src="/images/shirt.jpg" /></body></html>';
    const result = extractBySelectors(
      imgHtml,
      { photo: 'img.photo' },
      'https://shop.example.com/product/1',
    );
    expect(result.photo).toBe('https://shop.example.com/images/shirt.jpg');
  });

  it('falls back to data-src for lazy-loaded images', () => {
    const imgHtml = '<html><body><img class="photo" data-src="/lazy.jpg" /></body></html>';
    const result = extractBySelectors(imgHtml, { photo: 'img.photo' }, 'https://example.com/');
    expect(result.photo).toBe('https://example.com/lazy.jpg');
  });

  it('keeps an already-absolute image URL unresolved when no baseUrl is given', () => {
    const imgHtml = '<html><body><img class="photo" src="https://cdn.example.com/x.jpg" /></body></html>';
    const result = extractBySelectors(imgHtml, { photo: 'img.photo' });
    expect(result.photo).toBe('https://cdn.example.com/x.jpg');
  });
});
