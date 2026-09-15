import * as cheerio from 'cheerio';

export interface PageMetadata {
  title?: string;
  description?: string;
  language?: string;
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

  return { title, description, language, sourceURL: sourceUrl, statusCode };
}
