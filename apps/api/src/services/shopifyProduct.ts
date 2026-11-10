import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import { fetchPage, type FetchOptions } from './fetcher.js';

/**
 * A Shopify product's own variant option data - the merchant-defined
 * option NAMES ("Team", "Condition", "Size") alongside each variant's
 * values for them. Confirmed as the only place vintagefootballshirts.com
 * states a listing's condition and size at all: neither appears in the
 * title/description, only as variant options (a sold page shows Condition
 * "Fair", Size "Medium" in its variant picker). Without this, condition
 * fell back to grading the whole page's text, which on that site includes
 * its sitewide condition filter facets ("Mint", "w/tags", "BNIB", ...) -
 * every single listing came out Mint or Brand New (With Tags).
 */
export interface ShopifyProductOptions {
  handle: string | null;
  /** Option names in position order (option1, option2, option3). */
  options: string[];
  variants: Array<{ id: string | null; values: Array<string | null> }>;
}

type JsonObject = Record<string, unknown>;

function asObject(v: unknown): JsonObject | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : null;
}

function asTrimmedString(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

/**
 * The product handle from a Shopify product URL - `/products/<handle>`,
 * also under a collection (`/collections/x/products/<handle>`) or a
 * Shopify Markets locale prefix (`/en-gb/products/<handle>`). Null for
 * anything that isn't a product page.
 */
export function shopifyProductHandle(url: string | null | undefined): string | null {
  if (!url) return null;
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  const m = pathname.match(/\/products\/([^/?#]+?)(?:\.(?:js|json|oembed))?\/?$/i);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]).toLowerCase();
  } catch {
    return m[1].toLowerCase();
  }
}

/** Shopify's own `?variant=<id>` deep-link parameter, if the URL carries one. */
export function shopifyVariantIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const v = new URL(url).searchParams.get('variant');
    return v && /^\d+$/.test(v.trim()) ? v.trim() : null;
  } catch {
    return null;
  }
}

/** Shopify's public AJAX product endpoint for this product page's handle. */
export function shopifyProductJsUrl(url: string | null | undefined): string | null {
  const handle = shopifyProductHandle(url);
  if (!url || !handle) return null;
  try {
    return `${new URL(url).origin}/products/${encodeURIComponent(handle)}.js`;
  } catch {
    return null;
  }
}

/** Markers every Shopify storefront's own HTML carries, whatever theme it runs. */
export function isShopifyHtml(html: string | null | undefined): boolean {
  if (!html) return false;
  return /cdn\.shopify\.com|Shopify\.shop\s*=|id=["']shopify-features["']|name=["']shopify-digital-wallet["']/i.test(html);
}

/**
 * Normalises either of Shopify's public product JSON shapes into
 * ShopifyProductOptions: `/products/<handle>.js` (`options` as an array of
 * names, or of {name, position, values} on newer stores) and
 * `/products/<handle>.json` (the same wrapped in `{ product: ... }`, with
 * `options` as {name, position, values}). Variant values are read from
 * `option1`/`option2`/`option3`, or a variant's own `options` array when
 * those aren't present. Null for anything that doesn't carry both option
 * names and variants - a theme's variant-only JSON blob (no names) can't
 * tell which value is the condition and which the size.
 */
export function parseShopifyProductJson(raw: unknown): ShopifyProductOptions | null {
  let product = asObject(raw);
  if (!product) return null;
  const wrapped = asObject(product.product);
  if (wrapped) product = wrapped;

  if (!Array.isArray(product.options) || !Array.isArray(product.variants)) return null;

  const withPosition = product.options.map((o, i) => {
    if (typeof o === 'string') return { name: o.trim(), position: i + 1 };
    const obj = asObject(o);
    const name = obj ? asTrimmedString(obj.name) : null;
    const position = obj && typeof obj.position === 'number' ? obj.position : i + 1;
    return { name: name ?? '', position };
  });
  withPosition.sort((a, b) => a.position - b.position);
  const options = withPosition.map((o) => o.name);
  if (options.length === 0 || options.some((n) => !n)) return null;

  const variants: ShopifyProductOptions['variants'] = [];
  for (const v of product.variants) {
    const obj = asObject(v);
    if (!obj) continue;
    const fromKeys = [obj.option1, obj.option2, obj.option3].map(asTrimmedString);
    const fromArray = Array.isArray(obj.options) ? obj.options.map(asTrimmedString) : [];
    const values = options.map((_, i) => fromKeys[i] ?? fromArray[i] ?? null);
    variants.push({ id: asTrimmedString(obj.id), values });
  }
  if (variants.length === 0) return null;

  return { handle: asTrimmedString(product.handle)?.toLowerCase() ?? null, options, variants };
}

/**
 * Product JSON a theme embedded in the page itself (`<script
 * type="application/json" data-product-json>`, `#ProductJson-...`, and
 * similar) - read before ever making a separate request. A blob that names
 * its own handle must match this page's handle (a related-products block
 * can embed some OTHER product's JSON on the same page); one with no
 * handle at all is only trusted when the theme explicitly marked it as
 * this page's product JSON.
 */
export function extractEmbeddedShopifyProduct($: CheerioAPI, pageUrl: string): ShopifyProductOptions | null {
  const handle = shopifyProductHandle(pageUrl);
  if (!handle) return null;
  for (const el of $('script[type="application/json"], script[data-product-json]').toArray()) {
    const raw = $(el).contents().text();
    if (!raw.trim() || raw.length > 1_000_000) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const product = parseShopifyProductJson(parsed);
    if (!product) continue;
    if (product.handle) {
      if (product.handle === handle) return product;
      continue;
    }
    const id = $(el).attr('id') ?? '';
    if ($(el).attr('data-product-json') !== undefined || /^ProductJson/i.test(id)) return product;
  }
  return null;
}

/**
 * The option values that describe THIS listing, keyed by option name:
 * the only variant, if there's one; else the variant the URL's
 * `?variant=` id selects; otherwise only those options every variant
 * shares the same value for (e.g. one Condition across several sizes).
 * An option whose value differs between variants with nothing to pick
 * between them is left out entirely rather than guessed.
 */
export function selectShopifyVariantOptions(
  product: ShopifyProductOptions,
  variantId?: string | null,
): Record<string, string> {
  const toRecord = (values: Array<string | null>): Record<string, string> => {
    const out: Record<string, string> = {};
    product.options.forEach((name, i) => {
      const v = values[i];
      if (v) out[name] = v;
    });
    return out;
  };
  if (product.variants.length === 1) return toRecord(product.variants[0].values);
  if (variantId) {
    const match = product.variants.find((v) => v.id === variantId);
    if (match) return toRecord(match.values);
  }
  const shared = product.options.map((_, i) => {
    const first = product.variants[0].values[i];
    if (!first) return null;
    return product.variants.every((v) => v.values[i]?.toLowerCase() === first.toLowerCase()) ? first : null;
  });
  return toRecord(shared);
}

/**
 * Maps the selected option values onto the `extracted` field names
 * buildKickioProfile reads (`condition`, `size`) - only the options whose
 * merchant-defined name says what they are, never by value-sniffing.
 */
export function shopifyOptionsToExtracted(selected: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(selected)) {
    const n = name.trim().toLowerCase();
    if (!out.condition && /^condition$/.test(n)) out.condition = value;
    else if (!out.size && /^(?:shirt\s+)?size$/.test(n)) out.size = value;
  }
  return out;
}

function parseJsonBody(body: string): unknown {
  const trimmed = body.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // A browser-rendered fallback (fetchPage retries a blocked request
    // through Playwright) wraps a JSON response in an HTML document.
    if (!trimmed.startsWith('<')) return null;
    try {
      return JSON.parse(cheerio.load(trimmed)('body').text().trim());
    } catch {
      return null;
    }
  }
}

/**
 * One extra request to Shopify's public `/products/<handle>.js` endpoint,
 * through the same fetchPage pipeline (robots.txt, the site's own rate
 * limit, proxy) as every other request this app makes. Never throws -
 * any failure just means no variant data, same as before this existed.
 */
export async function fetchShopifyProduct(
  pageUrl: string,
  opts: Pick<FetchOptions, 'proxyUrl' | 'rateLimitRps'>,
): Promise<ShopifyProductOptions | null> {
  const jsUrl = shopifyProductJsUrl(pageUrl);
  if (!jsUrl) return null;
  try {
    const res = await fetchPage(jsUrl, { useBrowser: false, proxyUrl: opts.proxyUrl, rateLimitRps: opts.rateLimitRps });
    if (res.error || res.blocked || res.statusCode < 200 || res.statusCode >= 300) return null;
    const product = parseShopifyProductJson(parseJsonBody(res.html));
    // Not checked against the page's handle: the request itself was made
    // by handle, and Shopify redirects a renamed product's old handle to
    // its new one, so a mismatch here is still this same product.
    return product;
  } catch {
    return null;
  }
}
