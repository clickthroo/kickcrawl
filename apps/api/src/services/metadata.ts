import * as cheerio from 'cheerio';

export interface PageMetadata {
  title?: string;
  description?: string;
  language?: string;
  image?: string;
  sourceURL: string;
  statusCode: number;
}

export function extractMetadata(html: string, sourceUrl: string, statusCode: number): PageMetadata {
  const $ = cheerio.load(html);
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
