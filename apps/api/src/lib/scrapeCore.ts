import * as cheerio from 'cheerio';
import { fetchPage } from '../services/fetcher.js';
import { extractMetadata, type PageMetadata } from '../services/metadata.js';
import { getContentHtml } from '../services/mainContent.js';
import { htmlToMarkdown } from '../services/markdown.js';
import { extractLinks } from '../services/links.js';
import { extractBySelectors, type SelectorMap } from '../services/extractor.js';
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

export async function scrapePage(
  url: string,
  opts: ScrapeOptions,
  site?: SiteConfig | null,
): Promise<ScrapeCoreResult> {
  const formats = opts.formats ?? ['markdown'];
  const useBrowser = opts.useBrowser ?? site?.use_browser_default ?? false;

  const result = await fetchPage(url, {
    useBrowser,
    waitFor: opts.waitFor,
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
      waitFor: opts.waitFor,
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
  if (Object.keys(selectors).length > 0) {
    out.extracted = extractBySelectors(finalResult.html, selectors, finalResult.finalUrl);
  }

  return out;
}
