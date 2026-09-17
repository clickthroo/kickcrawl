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
      metadata: { sourceURL: url, statusCode: result.statusCode },
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

  const metadata = extractMetadata(finalResult.html, finalResult.finalUrl, finalResult.statusCode);
  const contentHtml = getContentHtml(finalResult.html, opts.onlyMainContent ?? true);
  const $ = cheerio.load(finalResult.html);

  const out: ScrapeCoreResult = { success: true, metadata, rawHtml: finalResult.html };

  if (formats.includes('markdown')) out.markdown = htmlToMarkdown(contentHtml);
  if (formats.includes('html')) out.html = finalResult.html;
  if (formats.includes('links')) out.links = extractLinks($, finalResult.finalUrl);

  const selectors = { ...(site?.default_selectors ?? {}), ...(opts.selectors ?? {}) };
  const extracted =
    Object.keys(selectors).length > 0 ? extractBySelectors(finalResult.html, selectors, finalResult.finalUrl) : {};

  // A site-configured selector always wins (it was picked for a reason), but
  // most sites won't have one - schema.org JSON-LD is the standard
  // e-commerce SEO markup (Shopify, WooCommerce, Magento all emit it by
  // default), so it fills price/currency/stock with real data instead of
  // leaving every listing blank until someone hand-writes a CSS selector.
  const structured = extractStructuredProductData(finalResult.html);
  if (structured.price && !extracted.price) extracted.price = structured.price;
  if (structured.currency && !extracted.currency) extracted.currency = structured.currency;
  if (structured.availability && !extracted.availability) extracted.availability = structured.availability;
  if (structured.sku && !extracted.sku) extracted.sku = structured.sku;

  if (Object.keys(extracted).length > 0) out.extracted = extracted;

  return out;
}
