import * as cheerio from 'cheerio';

const NOISE_SELECTORS = [
  'nav',
  'header',
  'footer',
  'script',
  'style',
  'noscript',
  'svg',
  // Form *fields* (inputs, dropdowns, labels) are noise - placeholder text,
  // giant size/variant <option> lists, "Email address" newsletter labels -
  // but the <form> itself is not: on essentially every e-commerce site
  // (confirmed on vintagefootballshirts.com's Shopify theme) the real
  // "Add to Bag"/"Add to Cart" buy button lives inside a <form
  // action="/cart/add">. Removing the whole form (as this used to do)
  // silently deleted that button's text from every single product page's
  // markdown, with no way for detectStockStatus's in-stock phrase matching
  // (kickioProfile.ts) to ever see it - confirmed in production via a
  // temporary diagnostic that found the "add to (cart|basket|bag)" pattern
  // in exactly 0 of 482 real scraped listings. Stripping only the field
  // noise keeps the button's visible text while still dropping the actual
  // clutter.
  'input',
  'select',
  'textarea',
  'label',
  'option',
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
