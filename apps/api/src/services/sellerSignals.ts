/**
 * Vinted-style seller trust signals (a "Pro" seller badge + their
 * feedback/review count), read from the page's own rendered text rather
 * than CSS selectors - a JS-heavy marketplace's generated/hashed class
 * names would be both unguessable and fragile, whereas the visible text
 * is stable regardless of how the DOM happens to be built.
 *
 * Confirmed against a real Vinted item page's seller card (copy-pasted
 * as plain text): three consecutive lines - the seller's name, then a
 * bare number with no parentheses (their feedback count - the star-
 * rating icons carry no text of their own, so nothing sits between the
 * name and the count), then "Pro" on its own line for a Pro seller. A
 * non-Pro seller's card has no such line at that position - instead
 * other badges ("Frequent Uploads", "Speedy Shipping") or nothing.
 */

export interface SellerSignals {
  feedbackCount: number | null;
  isPro: boolean;
}

export function detectSellerSignals(text: string): SellerSignals {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    if (/^\d{1,7}$/.test(lines[i])) {
      return {
        feedbackCount: parseInt(lines[i], 10),
        isPro: lines[i + 1] === 'Pro',
      };
    }
  }
  return { feedbackCount: null, isPro: false };
}
