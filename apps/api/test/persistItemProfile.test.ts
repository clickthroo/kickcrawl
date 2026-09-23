import { describe, expect, it } from 'vitest';
import { profileToColumns } from '../src/lib/persistItemProfile.js';
import type { KickioProfile } from '../src/services/kickioProfile.js';

function baseProfile(overrides: Partial<KickioProfile> = {}): KickioProfile {
  return {
    source: { marketplace: null, url: 'https://example.com/x', scraped_at: '2026-01-01T00:00:00.000Z' },
    category: 'Football Shirts',
    identity: {
      team: 'Arsenal',
      team_kickio_match: 'Arsenal',
      season: '2019-20',
      extra_seasons: [],
      shirt_type: 'Away',
      gender: 'Mens',
      issue: 'Standard Retail Version',
      special_edition: 'Not A Special Edition',
      sleeves: 'Short-Sleeved',
      signed: 'Not Signed',
      player: null,
      number: null,
    },
    listing: {
      condition: 'Brand New (With Tags)',
      size: 'S',
      manufacturer: 'Adidas',
      colour: 'Yellow',
      colour_secondary: 'Black',
      boxed_edition: 'Not A Boxed Edition',
      price: 175,
      currency: 'GBP',
      original_price: null,
      original_currency: null,
      fx_rate_used: null,
      quantity: null,
      images: [],
      stock_status: 'Out of Stock',
    },
    custom_attributes: {},
    confidence: {},
    needs_review: false,
    review_reason: null,
    ...overrides,
  };
}

describe('profileToColumns', () => {
  it('flattens the fields the admin Items list filters by into their own columns', () => {
    const profile = baseProfile();
    expect(profileToColumns(profile)).toEqual({
      stock_status: 'Out of Stock',
      team: 'Arsenal',
      season: '2019-20',
      shirt_type: 'Away',
      player: null,
      player_number: null,
      colour: 'Yellow',
      colour_secondary: 'Black',
      size: 'S',
      manufacturer: 'Adidas',
      condition: 'Brand New (With Tags)',
    });
  });

  it('maps identity.number to the player_number column, not a bare "number" name', () => {
    const profile = baseProfile({
      identity: { ...baseProfile().identity, player: 'Bergkamp', number: '10' },
    });
    const columns = profileToColumns(profile);
    expect(columns.player).toBe('Bergkamp');
    expect(columns.player_number).toBe('10');
  });
});
