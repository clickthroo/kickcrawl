import * as cheerio from 'cheerio';

const NOISE_SELECTORS = [
  'nav',
  'header',
  'footer',
  'script',
  'style',
  'noscript',
  'svg',
  'form',
  '[role="banner"]',
  '[role="navigation"]',
  '.cookie-banner',
  '.cookie-consent',
];

const MAIN_CONTENT_SELECTORS = ['main', 'article', '#content', '.content', '[role="main"]'];

/** Strips nav/header/footer chrome and, if requested, narrows to the page's likely main content region. */
export function getContentHtml(html: string, onlyMainContent: boolean): string {
  const $ = cheerio.load(html);
  $(NOISE_SELECTORS.join(',')).remove();

  if (!onlyMainContent) {
    return $('body').html() ?? html;
  }

  for (const selector of MAIN_CONTENT_SELECTORS) {
    const el = $(selector).first();
    if (el.length && el.text().trim().length > 100) {
      return $.html(el) ?? '';
    }
  }
  return $('body').html() ?? html;
}
