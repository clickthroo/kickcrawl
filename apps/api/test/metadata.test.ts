import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';
import { extractMetadata } from '../src/services/metadata.js';

describe('extractMetadata', () => {
  it('extracts title, description, language, and resolves og:image to an absolute URL', () => {
    const html = `
      <html lang="en">
        <head>
          <title>1990-91 Manchester United Home Shirt</title>
          <meta name="description" content="A classic shirt" />
          <meta property="og:image" content="/images/shirt.jpg" />
        </head>
        <body></body>
      </html>
    `;
    const meta = extractMetadata(cheerio.load(html), 'https://shop.example.com/product/1', 200);
    expect(meta.title).toBe('1990-91 Manchester United Home Shirt');
    expect(meta.description).toBe('A classic shirt');
    expect(meta.language).toBe('en');
    expect(meta.image).toBe('https://shop.example.com/images/shirt.jpg');
    expect(meta.sourceURL).toBe('https://shop.example.com/product/1');
    expect(meta.statusCode).toBe(200);
  });

  it('falls back to twitter:image when og:image is missing', () => {
    const html = '<html><head><meta name="twitter:image" content="https://cdn.example.com/x.jpg" /></head></html>';
    const meta = extractMetadata(cheerio.load(html), 'https://example.com/', 200);
    expect(meta.image).toBe('https://cdn.example.com/x.jpg');
  });

  it('leaves image undefined when no image meta tag is present', () => {
    const meta = extractMetadata(cheerio.load('<html><head></head></html>'), 'https://example.com/', 200);
    expect(meta.image).toBeUndefined();
  });
});
