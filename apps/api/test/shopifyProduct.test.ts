import * as cheerio from 'cheerio';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  extractEmbeddedShopifyProduct,
  isShopifyHtml,
  parseShopifyProductJson,
  selectShopifyVariantOptions,
  shopifyOptionsToExtracted,
  shopifyProductHandle,
  shopifyProductJsUrl,
  shopifyVariantIdFromUrl,
} from '../src/services/shopifyProduct.js';

const VFS_URL =
  'https://www.vintagefootballshirts.com/collections/umbro/products/1998-00-manchester-united-umbro-home-shirt-beckham-7-m-1';

// Shape of Shopify's public /products/<handle>.js response (options as
// plain names - the long-standing AJAX API format).
const VFS_PRODUCT_JS = {
  id: 1,
  handle: '1998-00-manchester-united-umbro-home-shirt-beckham-7-m-1',
  title: '1998-00 Manchester United Umbro Home Shirt Beckham #7 M',
  options: ['Team', 'Condition', 'Size'],
  variants: [
    {
      id: 4242,
      title: 'Manchester United / Fair / Medium',
      option1: 'Manchester United',
      option2: 'Fair',
      option3: 'Medium',
      available: false,
    },
  ],
};

describe('shopifyProductHandle / shopifyProductJsUrl / shopifyVariantIdFromUrl', () => {
  it('reads the handle from a collection-scoped product URL', () => {
    expect(shopifyProductHandle(VFS_URL)).toBe('1998-00-manchester-united-umbro-home-shirt-beckham-7-m-1');
    expect(shopifyProductJsUrl(VFS_URL)).toBe(
      'https://www.vintagefootballshirts.com/products/1998-00-manchester-united-umbro-home-shirt-beckham-7-m-1.js',
    );
  });

  it('handles plain and locale-prefixed product URLs, and ignores non-product pages', () => {
    expect(shopifyProductHandle('https://shop.example/products/foo?variant=12')).toBe('foo');
    expect(shopifyProductHandle('https://shop.example/en-gb/products/foo/')).toBe('foo');
    expect(shopifyProductHandle('https://shop.example/collections/umbro')).toBeNull();
    expect(shopifyProductJsUrl('https://shop.example/collections/umbro')).toBeNull();
  });

  it('reads a numeric ?variant= id only', () => {
    expect(shopifyVariantIdFromUrl('https://shop.example/products/foo?variant=123')).toBe('123');
    expect(shopifyVariantIdFromUrl('https://shop.example/products/foo?variant=abc')).toBeNull();
    expect(shopifyVariantIdFromUrl('https://shop.example/products/foo')).toBeNull();
  });
});

describe('parseShopifyProductJson', () => {
  it('parses the /products/<handle>.js shape (options as names)', () => {
    const p = parseShopifyProductJson(VFS_PRODUCT_JS);
    expect(p?.options).toEqual(['Team', 'Condition', 'Size']);
    expect(p?.variants).toEqual([{ id: '4242', values: ['Manchester United', 'Fair', 'Medium'] }]);
  });

  it('parses the /products/<handle>.json shape (wrapped, options as objects, sorted by position)', () => {
    const p = parseShopifyProductJson({
      product: {
        handle: 'foo',
        options: [
          { name: 'Size', position: 2, values: ['M'] },
          { name: 'Condition', position: 1, values: ['Very Good'] },
        ],
        variants: [{ id: 1, option1: 'Very Good', option2: 'M' }],
      },
    });
    expect(p?.options).toEqual(['Condition', 'Size']);
    expect(p?.variants[0].values).toEqual(['Very Good', 'M']);
  });

  it('rejects a variants-only blob with no option names', () => {
    expect(parseShopifyProductJson([{ id: 1, options: ['Fair', 'Medium'] }])).toBeNull();
    expect(parseShopifyProductJson({ variants: [{ id: 1 }] })).toBeNull();
    expect(parseShopifyProductJson(null)).toBeNull();
  });
});

describe('selectShopifyVariantOptions', () => {
  const multi = parseShopifyProductJson({
    options: ['Condition', 'Size'],
    variants: [
      { id: 1, option1: 'Very Good', option2: 'S' },
      { id: 2, option1: 'Very Good', option2: 'L' },
    ],
  })!;

  it('uses the only variant when there is just one', () => {
    expect(selectShopifyVariantOptions(parseShopifyProductJson(VFS_PRODUCT_JS)!)).toEqual({
      Team: 'Manchester United',
      Condition: 'Fair',
      Size: 'Medium',
    });
  });

  it('uses the variant the URL selects', () => {
    expect(selectShopifyVariantOptions(multi, '2')).toEqual({ Condition: 'Very Good', Size: 'L' });
  });

  it('otherwise keeps only the options every variant agrees on - never guesses a size', () => {
    expect(selectShopifyVariantOptions(multi, null)).toEqual({ Condition: 'Very Good' });
    expect(selectShopifyVariantOptions(multi, '999')).toEqual({ Condition: 'Very Good' });
  });

  it('leaves condition unset when variants disagree on it', () => {
    const mixed = parseShopifyProductJson({
      options: ['Condition', 'Size'],
      variants: [
        { id: 1, option1: 'Mint', option2: 'M' },
        { id: 2, option1: 'Good', option2: 'M' },
      ],
    })!;
    expect(selectShopifyVariantOptions(mixed, null)).toEqual({ Size: 'M' });
  });
});

describe('shopifyOptionsToExtracted', () => {
  it('maps only the Condition and Size options, by name', () => {
    expect(shopifyOptionsToExtracted({ Team: 'Manchester United', Condition: 'Fair', Size: 'Medium' })).toEqual({
      condition: 'Fair',
      size: 'Medium',
    });
    expect(shopifyOptionsToExtracted({ Colour: 'Red', Title: 'Default Title' })).toEqual({});
  });
});

describe('extractEmbeddedShopifyProduct', () => {
  it('reads product JSON a theme embedded for this page', () => {
    const $ = cheerio.load(
      `<script type="application/json" data-product-json>${JSON.stringify({ ...VFS_PRODUCT_JS, handle: undefined })}</script>`,
    );
    expect(extractEmbeddedShopifyProduct($, VFS_URL)?.variants[0].values[1]).toBe('Fair');
  });

  it("ignores some OTHER product's embedded JSON (a related-products block)", () => {
    const $ = cheerio.load(
      `<script type="application/json">${JSON.stringify({ ...VFS_PRODUCT_JS, handle: 'another-shirt' })}</script>`,
    );
    expect(extractEmbeddedShopifyProduct($, VFS_URL)).toBeNull();
  });

  it('accepts an unmarked blob only when its handle matches this page', () => {
    const $ = cheerio.load(`<script type="application/json">${JSON.stringify(VFS_PRODUCT_JS)}</script>`);
    expect(extractEmbeddedShopifyProduct($, VFS_URL)).not.toBeNull();
  });
});

describe('isShopifyHtml', () => {
  it('recognises a Shopify storefront', () => {
    expect(isShopifyHtml('<link href="//cdn.shopify.com/s/files/x.css">')).toBe(true);
    expect(isShopifyHtml('<script>Shopify.shop = "x.myshopify.com";</script>')).toBe(true);
    expect(isShopifyHtml('<html><body>hi</body></html>')).toBe(false);
  });
});

describe('scrapePage - Shopify variant options', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  const SHOPIFY_PAGE = `<html><head><title>1998-00 Manchester United Umbro Home Shirt Beckham #7 M | Vintage Football Shirts</title>
    <script>Shopify.shop = "vintagefootballshirts.myshopify.com";</script></head>
    <body><p>Condition Mint w/tags BNIB Very good</p></body></html>`;

  it("fetches /products/<handle>.js when the page embeds nothing, and fills condition/size from the variant", async () => {
    const fetchPage = vi.fn(async (url: string) =>
      url.endsWith('.js')
        ? { html: JSON.stringify(VFS_PRODUCT_JS), statusCode: 200, usedBrowser: false, finalUrl: url, blocked: false }
        : { html: SHOPIFY_PAGE, statusCode: 200, usedBrowser: false, finalUrl: VFS_URL, blocked: false },
    );
    vi.doMock('../src/services/fetcher.js', () => ({ fetchPage }));

    const { scrapePage } = await import('../src/lib/scrapeCore.js');
    const result = await scrapePage(VFS_URL, { formats: ['markdown'] }, null);

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage.mock.calls[1][0]).toBe(
      'https://www.vintagefootballshirts.com/products/1998-00-manchester-united-umbro-home-shirt-beckham-7-m-1.js',
    );
    expect(result.extracted?.condition).toBe('Fair');
    expect(result.extracted?.size).toBe('Medium');
  });

  it('makes no extra request for a non-Shopify page', async () => {
    const fetchPage = vi.fn(async () => ({
      html: '<html><body>hi</body></html>',
      statusCode: 200,
      usedBrowser: false,
      finalUrl: 'https://example.com/products/foo',
      blocked: false,
    }));
    vi.doMock('../src/services/fetcher.js', () => ({ fetchPage }));

    const { scrapePage } = await import('../src/lib/scrapeCore.js');
    await scrapePage('https://example.com/products/foo', { formats: ['markdown'] }, null);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('survives a failed .js request - no variant data, no error', async () => {
    const fetchPage = vi.fn(async (url: string) =>
      url.endsWith('.js')
        ? { html: '', statusCode: 404, usedBrowser: false, finalUrl: url, blocked: false }
        : { html: SHOPIFY_PAGE, statusCode: 200, usedBrowser: false, finalUrl: VFS_URL, blocked: false },
    );
    vi.doMock('../src/services/fetcher.js', () => ({ fetchPage }));

    const { scrapePage } = await import('../src/lib/scrapeCore.js');
    const result = await scrapePage(VFS_URL, { formats: ['markdown'] }, null);
    expect(result.success).toBe(true);
    expect(result.extracted?.condition).toBeUndefined();
  });
});
