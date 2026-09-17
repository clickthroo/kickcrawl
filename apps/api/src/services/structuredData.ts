import type { CheerioAPI } from 'cheerio';

export interface StructuredProductData {
  price: string | null;
  currency: string | null;
  availability: string | null;
  sku: string | null;
  /** Every image found across all Product nodes, in document order - schema.org's Product.image can be a single URL, an ImageObject, or an array of either. */
  images: string[];
}

type OfferData = Omit<StructuredProductData, 'images'>;

const EMPTY_OFFER: OfferData = { price: null, currency: null, availability: null, sku: null };

/**
 * A single JSON-LD node, loosely typed - schema.org's Product/Offer shapes
 * are large and this only ever reads a handful of fields, so a full type
 * isn't worth maintaining.
 */
type JsonLdNode = Record<string, unknown>;

function isProductNode(node: unknown): node is JsonLdNode {
  if (!node || typeof node !== 'object') return false;
  const type = (node as JsonLdNode)['@type'];
  if (typeof type === 'string') return type.toLowerCase() === 'product';
  if (Array.isArray(type)) return type.some((t) => typeof t === 'string' && t.toLowerCase() === 'product');
  return false;
}

/** Product nodes can be top-level, wrapped in an array, or nested under @graph (common with SEO plugins that emit multiple schema types on one page). */
function findProductNodes(parsed: unknown): JsonLdNode[] {
  if (Array.isArray(parsed)) return parsed.flatMap(findProductNodes);
  if (!parsed || typeof parsed !== 'object') return [];
  const node = parsed as JsonLdNode;
  const found = isProductNode(node) ? [node] : [];
  if (Array.isArray(node['@graph'])) return [...found, ...findProductNodes(node['@graph'])];
  return found;
}

function firstOffer(node: JsonLdNode): JsonLdNode | null {
  const offers = node.offers;
  if (!offers || typeof offers !== 'object') return null;
  if (Array.isArray(offers)) return (offers[0] as JsonLdNode) ?? null;
  return offers as JsonLdNode;
}

function asString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * schema.org's Offer.availability is a URL ("https://schema.org/InStock"),
 * but some sites emit just the bare token - kept as-is either way, since
 * kickioProfile's detectStockStatus already matches both forms.
 */
function readOfferData(node: JsonLdNode): OfferData {
  const offer = firstOffer(node);
  if (!offer) return EMPTY_OFFER;
  return {
    price: asString(offer.price ?? offer.lowPrice),
    currency: asString(offer.priceCurrency),
    availability: asString(offer.availability),
    sku: asString(node.sku ?? offer.sku),
  };
}

/** schema.org's Product.image is a single URL string, an ImageObject ({ url: ... }), or an array of either. */
function readImages(node: JsonLdNode): string[] {
  const raw = node.image;
  if (!raw) return [];
  const toUrl = (v: unknown): string | null => {
    if (typeof v === 'string') return asString(v);
    if (v && typeof v === 'object' && 'url' in v) return asString((v as JsonLdNode).url);
    return null;
  };
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map(toUrl).filter((v): v is string => !!v);
}

/**
 * Reads a product page's schema.org JSON-LD (the standard e-commerce SEO
 * markup most platforms - Shopify, WooCommerce, Magento - emit by default)
 * for price/currency/stock, so Kickcrawl gets real product data without
 * needing a hand-picked CSS selector configured per site. Falls back to the
 * Shopify/Open Graph product meta tags, then schema.org microdata, when no
 * JSON-LD Product block is present. Must run against the *full* page HTML -
 * <script>/<meta> tags are stripped before markdown conversion - so the
 * CheerioAPI passed in must be parsed from that full HTML, not the
 * main-content-only subset. Takes an already-parsed CheerioAPI - see
 * metadata.ts's extractMetadata for why this and its sibling extractors
 * share one parse instead of each re-parsing the same HTML independently.
 */
export function extractStructuredProductData($: CheerioAPI): StructuredProductData {
  let offer: OfferData = EMPTY_OFFER;
  const images: string[] = [];

  for (const script of $('script[type="application/ld+json"]').toArray()) {
    const raw = $(script).contents().text();
    if (!raw.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    // Every Product node's images are worth keeping (a page can legitimately
    // list more than one), but only the first node that actually has a
    // price wins for the offer fields - the same "first real value, not
    // every value" rule the rest of this file already follows for price.
    for (const product of findProductNodes(parsed)) {
      images.push(...readImages(product));
      if (offer.price === null) {
        const data = readOfferData(product);
        if (data.price) offer = data;
      }
    }
  }

  if (offer.price === null) {
    const metaPrice =
      $('meta[property="product:price:amount"]').attr('content') ??
      $('meta[itemprop="price"]').attr('content');
    if (metaPrice) {
      offer = {
        price: asString(metaPrice),
        currency:
          $('meta[property="product:price:currency"]').attr('content') ??
          $('meta[itemprop="priceCurrency"]').attr('content') ??
          null,
        availability: $('meta[itemprop="availability"]').attr('content') ?? null,
        sku: $('meta[itemprop="sku"]').attr('content') ?? null,
      };
    }
  }

  return { ...offer, images };
}
