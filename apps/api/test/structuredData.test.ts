import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';
import { extractStructuredProductData } from '../src/services/structuredData.js';

function pageWithJsonLd(jsonLd: unknown): string {
  return `
    <html><head>
      <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
    </head><body><h1>1990-91 Manchester United Home Shirt</h1></body></html>
  `;
}

describe('extractStructuredProductData', () => {
  it('reads price/currency/availability/sku from a schema.org Product with a single Offer', () => {
    const html = pageWithJsonLd({
      '@context': 'https://schema.org',
      '@type': 'Product',
      sku: 'MUFC-9091-H',
      offers: {
        '@type': 'Offer',
        price: '49.99',
        priceCurrency: 'GBP',
        availability: 'https://schema.org/InStock',
      },
    });

    const result = extractStructuredProductData(cheerio.load(html));
    expect(result).toEqual({
      price: '49.99',
      currency: 'GBP',
      availability: 'https://schema.org/InStock',
      sku: 'MUFC-9091-H',
      images: [],
      additionalProperties: {},
    });
  });

  it('takes the first offer when offers is an array of variants', () => {
    const html = pageWithJsonLd({
      '@type': 'Product',
      offers: [
        { '@type': 'Offer', price: '45.00', priceCurrency: 'GBP' },
        { '@type': 'Offer', price: '50.00', priceCurrency: 'GBP' },
      ],
    });

    const result = extractStructuredProductData(cheerio.load(html));
    expect(result.price).toBe('45.00');
  });

  it('finds a Product node nested under @graph, as SEO plugins commonly emit', () => {
    const html = pageWithJsonLd({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebPage', name: 'Product page' },
        { '@type': 'Product', offers: { price: '32.50', priceCurrency: 'USD' } },
      ],
    });

    const result = extractStructuredProductData(cheerio.load(html));
    expect(result.price).toBe('32.50');
    expect(result.currency).toBe('USD');
  });

  it('skips a JSON-LD block that is valid JSON but not a Product (e.g. BreadcrumbList)', () => {
    const html = pageWithJsonLd({ '@type': 'BreadcrumbList', itemListElement: [] });
    expect(extractStructuredProductData(cheerio.load(html))).toEqual({
      price: null,
      currency: null,
      availability: null,
      sku: null,
      images: [],
      additionalProperties: {},
    });
  });

  it('does not throw on malformed JSON-LD and falls through to other signals', () => {
    const html = `
      <html><head>
        <script type="application/ld+json">{ this is not valid json }</script>
      </head><body></body></html>
    `;
    expect(extractStructuredProductData(cheerio.load(html))).toEqual({
      price: null,
      currency: null,
      availability: null,
      sku: null,
      images: [],
      additionalProperties: {},
    });
  });

  it('falls back to Shopify/Open Graph product meta tags when no JSON-LD Product is present', () => {
    const html = `
      <html><head>
        <meta property="product:price:amount" content="59.99" />
        <meta property="product:price:currency" content="GBP" />
      </head><body></body></html>
    `;
    const result = extractStructuredProductData(cheerio.load(html));
    expect(result.price).toBe('59.99');
    expect(result.currency).toBe('GBP');
  });

  it('falls back to schema.org microdata meta tags as a last resort', () => {
    const html = `
      <html><body>
        <div itemscope itemtype="https://schema.org/Offer">
          <meta itemprop="price" content="25.00" />
          <meta itemprop="priceCurrency" content="EUR" />
          <meta itemprop="availability" content="https://schema.org/OutOfStock" />
        </div>
      </body></html>
    `;
    const result = extractStructuredProductData(cheerio.load(html));
    expect(result.price).toBe('25.00');
    expect(result.currency).toBe('EUR');
    expect(result.availability).toBe('https://schema.org/OutOfStock');
  });

  it('returns all-null when the page has no structured product data at all', () => {
    const html = '<html><body><h1>Just a plain page</h1></body></html>';
    expect(extractStructuredProductData(cheerio.load(html))).toEqual({
      price: null,
      currency: null,
      availability: null,
      sku: null,
      images: [],
      additionalProperties: {},
    });
  });

  describe('images', () => {
    it('reads a single image URL string', () => {
      const html = pageWithJsonLd({ '@type': 'Product', image: 'https://example.com/shirt.jpg' });
      expect(extractStructuredProductData(cheerio.load(html)).images).toEqual(['https://example.com/shirt.jpg']);
    });

    it('reads an array of image URL strings, in order', () => {
      const html = pageWithJsonLd({
        '@type': 'Product',
        image: ['https://example.com/1.jpg', 'https://example.com/2.jpg'],
      });
      expect(extractStructuredProductData(cheerio.load(html)).images).toEqual([
        'https://example.com/1.jpg',
        'https://example.com/2.jpg',
      ]);
    });

    it('reads the url field of ImageObject entries', () => {
      const html = pageWithJsonLd({
        '@type': 'Product',
        image: [{ '@type': 'ImageObject', url: 'https://example.com/1.jpg' }, 'https://example.com/2.jpg'],
      });
      expect(extractStructuredProductData(cheerio.load(html)).images).toEqual([
        'https://example.com/1.jpg',
        'https://example.com/2.jpg',
      ]);
    });

    it('collects images even from a Product node with no price at all', () => {
      // Images and price are independent signals - a page can have a full
      // photo set in its JSON-LD without ever stating a price there (e.g.
      // Vinted's own item pages, where price only ever shows up as plain
      // page text, never in structured data).
      const html = pageWithJsonLd({ '@type': 'Product', image: 'https://example.com/shirt.jpg' });
      const result = extractStructuredProductData(cheerio.load(html));
      expect(result.price).toBeNull();
      expect(result.images).toEqual(['https://example.com/shirt.jpg']);
    });

    it('is empty when the Product node has no image field', () => {
      const html = pageWithJsonLd({ '@type': 'Product', offers: { price: '10.00' } });
      expect(extractStructuredProductData(cheerio.load(html)).images).toEqual([]);
    });
  });

  describe('additionalProperties', () => {
    it('reads Product.additionalProperty PropertyValue pairs - confirmed live on cultkits.com', () => {
      // Real shape from a live Cult Kits product page: an explicit "Team"
      // field, far more reliable than guessing one from the title text.
      const html = pageWithJsonLd({
        '@type': 'Product',
        offers: { price: '44.99', priceCurrency: 'GBP' },
        additionalProperty: [
          { '@type': 'PropertyValue', name: 'Size', value: 'Small' },
          { '@type': 'PropertyValue', name: 'Team', value: 'Manchester City' },
          { '@type': 'PropertyValue', name: 'Year', value: '2014' },
        ],
      });

      const result = extractStructuredProductData(cheerio.load(html));
      expect(result.additionalProperties).toEqual({ Size: 'Small', Team: 'Manchester City', Year: '2014' });
    });

    it('coerces a numeric value to a string, the same way price/sku already are', () => {
      const html = pageWithJsonLd({
        '@type': 'Product',
        offers: { price: '44.99' },
        additionalProperty: [{ '@type': 'PropertyValue', name: 'Year', value: 2014 }],
      });
      expect(extractStructuredProductData(cheerio.load(html)).additionalProperties).toEqual({ Year: '2014' });
    });

    it('skips a malformed entry (missing name, or a blank value) instead of throwing', () => {
      const html = pageWithJsonLd({
        '@type': 'Product',
        offers: { price: '44.99' },
        additionalProperty: [
          { '@type': 'PropertyValue', value: 'orphaned - no name' },
          { '@type': 'PropertyValue', name: 'Empty', value: '' },
          { '@type': 'PropertyValue', name: 'Team', value: 'Everton' },
          'not even an object',
        ],
      });
      expect(extractStructuredProductData(cheerio.load(html)).additionalProperties).toEqual({ Team: 'Everton' });
    });

    it('is empty when the winning Product node has no additionalProperty at all', () => {
      const html = pageWithJsonLd({ '@type': 'Product', offers: { price: '44.99' } });
      expect(extractStructuredProductData(cheerio.load(html)).additionalProperties).toEqual({});
    });

    it('only reads from the node that actually won the offer, not every Product node on the page', () => {
      // The multi-Product-block risk this whole file already has to guard
      // against elsewhere (a related-items carousel next to the real
      // listing) - a DIFFERENT product's "Team" must never leak into this
      // one's just because it happened to be first in the script tag.
      const html = pageWithJsonLd([
        { '@type': 'Product', additionalProperty: [{ name: 'Team', value: 'Wrong Team' }] }, // no price - never wins
        {
          '@type': 'Product',
          offers: { price: '44.99' },
          additionalProperty: [{ name: 'Team', value: 'Right Team' }],
        },
      ]);
      expect(extractStructuredProductData(cheerio.load(html)).additionalProperties).toEqual({ Team: 'Right Team' });
    });
  });
});
