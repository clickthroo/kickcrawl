import type { CheerioAPI } from 'cheerio';

export interface PageMetadata {
  title?: string;
  description?: string;
  language?: string;
  image?: string;
  sourceURL: string;
  statusCode: number;
}

/**
 * Takes an already-parsed CheerioAPI rather than raw HTML - scrapeCore.ts
 * parses a page's HTML once and shares that single $ across every reader
 * here, extractBySelectors and extractStructuredProductData. A large
 * JS-rendered page's HTML can be sizeable enough that re-parsing it
 * independently in each of these (as they each used to) meaningfully adds
 * up: it was a real contributor to a production V8 heap-exhaustion crash
 * on Vinted's catalog page.
 */
export function extractMetadata($: CheerioAPI, sourceUrl: string, statusCode: number): PageMetadata {
  const title = $('title').first().text().trim() || undefined;
  const description =
    $('meta[name="description"]').attr('content')?.trim() ||
    $('meta[property="og:description"]').attr('content')?.trim() ||
    undefined;
  const language = $('html').attr('lang')?.trim() || undefined;

  // og:image is almost always the page's main product/hero photo, so this
  // gives every scrape a human-friendly thumbnail for free, with no
  // per-site selector configuration required.
  const rawImage =
    $('meta[property="og:image"]').attr('content')?.trim() ||
    $('meta[name="twitter:image"]').attr('content')?.trim() ||
    undefined;
  let image: string | undefined;
  if (rawImage) {
    try {
      image = new URL(rawImage, sourceUrl).toString();
    } catch {
      image = rawImage;
    }
  }

  return { title, description, language, image, sourceURL: sourceUrl, statusCode };
}
