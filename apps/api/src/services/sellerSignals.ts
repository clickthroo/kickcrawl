/**
 * Vinted-style seller trust signals (a "Pro" seller badge + their
 * feedback/review count), read from the page's own rendered text rather
 * than CSS selectors - a JS-heavy marketplace's generated/hashed class
 * names would be both unguessable and fragile, whereas the visible text
 * is stable regardless of how the DOM happens to be built.
 *
 * Confirmed against a real Vinted item page's seller card, from the
 * scraper's own markdown output: three consecutive lines - the seller's
 * name (a markdown link to their profile), then their feedback count (the
 * star-rating icons carry no text of their own, so nothing sits between
 * the name and the count) - also a markdown link to the same profile, e.g.
 * "[86](https://www.vinted.co.uk/member/96669517)" rather than a bare
 * "86" - then "Pro" on its own plain line for a Pro seller. A non-Pro
 * seller's card has no such line at that position - instead other badges
 * ("Frequent Uploads", "Speedy Shipping") or nothing.
 */

export interface SellerSignals {
  feedbackCount: number | null;
  isPro: boolean;
}

const FEEDBACK_COUNT_LINE = /^\[?(\d{1,7})\]?(?:\([^)]*\))?$/;

export function detectSellerSignals(text: string): SellerSignals {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(FEEDBACK_COUNT_LINE);
    if (match) {
      return {
        feedbackCount: parseInt(match[1], 10),
        isPro: lines[i + 1] === 'Pro',
      };
    }
  }
  return { feedbackCount: null, isPro: false };
}
