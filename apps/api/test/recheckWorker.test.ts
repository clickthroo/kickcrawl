import { describe, expect, it } from 'vitest';
import { isNewSale } from '../src/workers/recheckWorker.js';

describe('isNewSale', () => {
  it('is a sale only on the exact In Stock -> Out of Stock transition', () => {
    expect(isNewSale('In Stock', 'Out of Stock')).toBe(true);
  });

  it('is not a sale when it was already out of stock last time - not a new event', () => {
    expect(isNewSale('Out of Stock', 'Out of Stock')).toBe(false);
  });

  it('is not a sale when it stays in stock', () => {
    expect(isNewSale('In Stock', 'In Stock')).toBe(false);
  });

  it('is not a sale when it comes back in stock (a restock, not a sale)', () => {
    expect(isNewSale('Out of Stock', 'In Stock')).toBe(false);
  });

  it('is not a sale from an unknown previous status - no confident "was in stock" to transition from', () => {
    expect(isNewSale('Unknown', 'Out of Stock')).toBe(false);
    expect(isNewSale(null, 'Out of Stock')).toBe(false);
  });

  it('is not a sale when the new status is unknown or null - nothing confidently confirms it sold', () => {
    expect(isNewSale('In Stock', 'Unknown')).toBe(false);
    expect(isNewSale('In Stock', null)).toBe(false);
  });
});
