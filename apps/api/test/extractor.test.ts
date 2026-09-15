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
});
