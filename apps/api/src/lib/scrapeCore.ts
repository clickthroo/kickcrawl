import * as cheerio from 'cheerio';
import { fetchPage } from '../services/fetcher.js';
import { extractMetadata, type PageMetadata } from '../services/metadata.js';
import { getContentHtml } from '../services/mainContent.js';
import { htmlToMarkdown } from '../services/markdown.js';
import { extractLinks } from '../services/links.js';
import { extractBySelectors, type SelectorMap } from '../services/extractor.js';
import { extractStructuredProductData } from '../services/structuredData.js';
import type { SiteConfig } from './siteResolver.js';

export type ScrapeFormat = 'markdown' | 'html' | 'links' | 'screenshot';

export interface ScrapeOptions {
  formats?: ScrapeFormat[];
  onlyMainContent?: boolean;
  waitFor?: number;
  useBrowser?: boolean;
  selectors?: SelectorMap;
}

export interface ScrapeCoreResult {
  success: boolean;
  markdown?: string;
  html?: string;
  links?: string[];
  metadata: PageMetadata;
  extracted?: Record<string, string>;
  error?: string;
  rawHtml?: string;
}

// A JS-rendered SPA's real content - search results, product data - is
// commonly still loading (via its own client-side XHR/fetch, after
// domcontentloaded already fired) when a browser-driven scrape captures
// the page. Vinted's catalog is the motivating case: without this, the
// page gets captured before its filtered search results have replaced
// whatever the page shows first, and every link on it - including
// unrelated recommendation/nav links - gets extracted as if it were a
// real result. A caller-supplied waitFor always wins; this is only the
// floor applied when nothing else asked for a specific one.
const DEFAULT_BROWSER_WAIT_MS = 2_000;

export async function scrapePage(
  url: string,
  opts: ScrapeOptions,
  site?: SiteConfig | null,
): Promise<ScrapeCoreResult> {
  const formats = opts.formats ?? ['markdown'];
  const useBrowser = opts.useBrowser ?? site?.use_browser_default ?? false;
  const waitFor = opts.waitFor ?? (useBrowser ? DEFAULT_BROWSER_WAIT_MS : 0);

  const result = await fetchPage(url, {
    useBrowser,
    waitFor,
    proxyUrl: site?.use_proxy ? process.env.PROXY_URL : undefined,
    rateLimitRps: site?.rate_limit_rps,
  });

  if (result.error) {
    return {
      success: false,
      error: result.error,
      metadata: { sourceURL: url, statusCode: result.statusCode, images: [] },
    };
  }

  // One retry through the browser if the fast path came back blocked.
  let finalResult = result;
  if (result.blocked && !result.usedBrowser) {
    finalResult = await fetchPage(url, {
      useBrowser: true,
      waitFor: opts.waitFor ?? DEFAULT_BROWSER_WAIT_MS,
      proxyUrl: site?.use_proxy ? process.env.PROXY_URL : undefined,
      rateLimitRps: site?.rate_limit_rps,
    });
  }

  // Parsed once and shared by every reader below (extractMetadata,
  // extractLinks, extractBySelectors, extractStructuredProductData) instead
  // of each independently re-parsing the same HTML - a large JS-rendered
  // page's HTML can be sizeable enough that 4-5x'ing the in-memory DOM tree
  // was a real contributor to a production V8 heap-exhaustion crash on
  // Vinted's catalog page. getContentHtml is the one exception: it removes
  // nav/header/footer/script/style elements to isolate "main content",
  // which would corrupt this shared, read-only $ for every reader after
  // it (structuredData's JSON-LD lives in a <script> tag getContentHtml
  // strips) - so it keeps its own separate, disposable parse.
  const $ = cheerio.load(finalResult.html);
  const metadata = extractMetadata($, finalResult.finalUrl, finalResult.statusCode);

  const out: ScrapeCoreResult = { success: true, metadata, rawHtml: finalResult.html };

  if (formats.includes('links')) out.links = extractLinks($, finalResult.finalUrl);

  // The rest of this pipeline - isolating "main content", converting it to
  // markdown, running selectors, reading structured product data - is real
  // work (and real memory: getContentHtml does its own separate parse, on
  // top of Turndown's own DOM walk) that only ever matters for a page whose
  // markdown/html/extracted fields someone actually reads. A crawl's own
  // link-discovery pages (Vinted's catalog/search listings, which are
  // never themselves items) only ever request 'links' - running this for
  // them was pure waste, and confirmed in production as the real cost that
  // was pushing the V8 heap over its limit while re-crawling Vinted.
  if (formats.includes('markdown') || formats.includes('html')) {
    const contentHtml = getContentHtml(finalResult.html, opts.onlyMainContent ?? true);
    if (formats.includes('markdown')) out.markdown = htmlToMarkdown(contentHtml);
    if (formats.includes('html')) out.html = finalResult.html;

    const selectors = { ...(site?.default_selectors ?? {}), ...(opts.selectors ?? {}) };
    const extracted =
      Object.keys(selectors).length > 0 ? extractBySelectors($, selectors, finalResult.finalUrl) : {};

    // A site-configured selector always wins (it was picked for a reason),
    // but most sites won't have one - schema.org JSON-LD is the standard
    // e-commerce SEO markup (Shopify, WooCommerce, Magento all emit it by
    // default), so it fills price/currency/stock with real data instead of
    // leaving every listing blank until someone hand-writes a CSS selector.
    const structured = extractStructuredProductData($);
    if (structured.price && !extracted.price) extracted.price = structured.price;
    if (structured.currency && !extracted.currency) extracted.currency = structured.currency;
    if (structured.availability && !extracted.availability) extracted.availability = structured.availability;
    if (structured.sku && !extracted.sku) extracted.sku = structured.sku;

    // Merge in whatever schema.org's Product.image gave us on top of the
    // og:image tags extractMetadata already found - a page can carry its
    // full photo gallery in either place (or split across both), and
    // neither source alone is guaranteed to have every photo.
    if (structured.images.length > 0) {
      metadata.images = [...new Set([...metadata.images, ...structured.images])];
      metadata.image = metadata.image ?? metadata.images[0];
    }

    if (Object.keys(extracted).length > 0) out.extracted = extracted;
  }

  return out;
}
