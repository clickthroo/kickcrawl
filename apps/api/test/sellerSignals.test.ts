import { describe, expect, it } from 'vitest';
import { detectSellerSignals } from '../src/services/sellerSignals.js';

describe('detectSellerSignals', () => {
  it('reads a Pro seller card exactly as copy-pasted from a real Vinted item page', () => {
    const result = detectSellerSignals('Cushty Kits\n524\nPro');
    expect(result).toEqual({ feedbackCount: 524, isPro: true });
  });

  it('reads a non-Pro seller card - no "Pro" line, other badges instead', () => {
    const text = [
      'mark7424',
      '138',
      'Frequent Uploads',
      'Regularly lists 5 or more items.',
      'Speedy Shipping',
      'Sends items promptly - usually within the next 24 hours.',
      'Last seen 7 min ago',
      'Follow',
    ].join('\n');
    expect(detectSellerSignals(text)).toEqual({ feedbackCount: 138, isPro: false });
  });

  it('does not mistake a stray "Pro" elsewhere on the page for the seller badge when no feedback count precedes it', () => {
    // e.g. an item description mentioning "pro-style" replica, or
    // unrelated page chrome - only a "Pro" directly after a bare-digit
    // line counts.
    const text = 'Some Seller\nGreat quality, worn by pros. Pro-style replica.';
    expect(detectSellerSignals(text)).toEqual({ feedbackCount: null, isPro: false });
  });

  it('returns nulls when there is no bare-digit line at all', () => {
    expect(detectSellerSignals('Just some page text with no seller card in it.')).toEqual({
      feedbackCount: null,
      isPro: false,
    });
  });

  it('ignores numbers with more than 7 digits (implausible as a feedback count, more likely an id/price fragment)', () => {
    expect(detectSellerSignals('Some Seller\n12345678901\nPro').feedbackCount).toBeNull();
  });
});
