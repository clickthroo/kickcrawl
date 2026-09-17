import type { CheerioAPI } from 'cheerio';

export interface PageMetadata {
  title?: string;
  description?: string;
  language?: string;
  /** The first image found - kept for callers that only ever wanted one. */
  image?: string;
  /** Every og:image found, in document order - a gallery page (a real Open Graph convention: "you can specify multiple og:image tags") commonly emits one per photo, not just its hero shot. */
  images: string[];
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
  // per-site selector configuration required. A page can legitimately
  // repeat the og:image tag once per photo (the Open Graph spec's own
  // multi-image convention) - collecting every one, not just the first,
  // is what actually gets a full gallery instead of a single thumbnail
  // for pages that use it that way.
  const resolve = (raw: string): string => {
    try {
      return new URL(raw, sourceUrl).toString();
    } catch {
      return raw;
    }
  };
  const ogImages = $('meta[property="og:image"]')
    .toArray()
    .map((el) => $(el).attr('content')?.trim())
    .filter((v): v is string => !!v)
    .map(resolve);
  const twitterImage = $('meta[name="twitter:image"]').attr('content')?.trim();
  const images = ogImages.length > 0 ? ogImages : twitterImage ? [resolve(twitterImage)] : [];
  const image = images[0];

  return { title, description, language, image, images, sourceURL: sourceUrl, statusCode };
}
