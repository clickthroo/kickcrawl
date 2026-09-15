import { describe, expect, it } from 'vitest';
import {
  buildKickioProfile,
  detectColours,
  detectShirtType,
  detectStockStatus,
  extractSeason,
  extractSeasonSpan,
  extractSizeFromTitle,
  gradeConditionText,
  guessTeamFromTitle,
} from '../src/services/kickioProfile.js';

describe('detectShirtType', () => {
  it('checks Goalkeeper before Home/Away', () => {
    expect(detectShirtType('Home Goalkeeper Shirt').type).toBe('GK Home');
    expect(detectShirtType('Home Goalkeeper Shirt').certain).toBe(true);
  });

  it('flags a bare Goalkeeper mention with no qualifier as uncertain', () => {
    const r = detectShirtType('Goalkeeper Shirt Size L');
    expect(r.type).toBe('GK Home');
    expect(r.certain).toBe(false);
  });

  it('treats Training/Pre-Match as informational only, no enum value', () => {
    const r = detectShirtType('Training Top');
    expect(r.type).toBeNull();
    expect(r.informationalOnly).toBe(true);
  });

  it('detects Away', () => {
    expect(detectShirtType('Man Utd 96/97 Away Shirt').type).toBe('Away');
  });

  it('defaults to Home when no token is present, but marks it uncertain', () => {
    const r = detectShirtType('Arsenal Shirt Size L');
    expect(r.type).toBe('Home');
    expect(r.certain).toBe(false);
  });
});

describe('extractSeason', () => {
  it('expands two-digit shorthand', () => {
    expect(extractSeason('Man Utd 96/97 Away Shirt').season).toBe('1996-97');
  });

  it('leaves a bare tournament year blank', () => {
    expect(extractSeason('1998 France World Cup Shirt').season).toBe('');
  });

  it('expands two bare eBay-style years into a range', () => {
    expect(extractSeason('Liverpool Home Shirt 1990 1992').season).toBe('1990-91');
  });

  it('collapses three consecutive seasons into one span with extras', () => {
    const r = extractSeasonSpan('Arsenal 1991-92 1992-93 1993-94 Home');
    expect(r.season).toBe('1991-92');
    expect(r.extraSeasons).toEqual(['1992-93', '1993-94']);
  });

  it('leaves multiple distinct season ranges blank', () => {
    expect(extractSeason('Chelsea 2010-11 and 2015-16 Home Shirt').season).toBe('');
  });
});

describe('guessTeamFromTitle', () => {
  it('recovers the team from a title, stripping type/season/manufacturer noise', () => {
    expect(guessTeamFromTitle('Manchester United 2012-13 Away Shirt Rooney #10')).toBe(
      'Manchester United',
    );
  });

  it('strips two-digit season shorthand too', () => {
    expect(guessTeamFromTitle('Man Utd 96/97 Away Shirt')).toBe('Man Utd');
  });

  it('strips a pipe-delimited site-name suffix rather than leaking it into the team', () => {
    expect(guessTeamFromTitle('1989-90 Wrexham Away Shirt M | Vintage Football Shirts')).toBe('Wrexham');
  });

  it('strips a dash-delimited site-name suffix even when a pipe suffix is absent', () => {
    expect(guessTeamFromTitle('1989-90 Wrexham Away Shirt M - Vintage Football Shirts')).toBe('Wrexham');
  });

  it('cuts at whichever of a dash or pipe subtitle delimiter comes first', () => {
    expect(guessTeamFromTitle('Wrexham Away Shirt | Site - Extra Junk')).toBe('Wrexham');
  });

  it('strips tournament words and a trailing leftover size letter', () => {
    expect(guessTeamFromTitle('1998 France World Cup Shirt Size M')).toBe('France');
  });

  it('returns empty rather than a bare size code when nothing real is left', () => {
    expect(guessTeamFromTitle('2020-21 Home Shirt Size L')).toBe('');
  });
});

describe('extractSizeFromTitle', () => {
  it('normalises common size notations', () => {
    expect(extractSizeFromTitle('Size L')).toBe('L');
    expect(extractSizeFromTitle('(XL)')).toBe('XL');
    expect(extractSizeFromTitle('Large')).toBe('L');
    expect(extractSizeFromTitle('Youth L')).toBe('Youth L');
  });
});

describe('gradeConditionText', () => {
  it('grades a numeric rating', () => {
    expect(gradeConditionText('8/10 condition')).toBe('Very Good');
  });

  it('recognises condition shorthand', () => {
    expect(gradeConditionText('BNWT')).toBe('Brand New (With Tags)');
    expect(gradeConditionText('new without tags')).toBe('Mint');
    expect(gradeConditionText('VGC')).toBe('Very Good');
  });

  it('returns null when nothing matches', () => {
    expect(gradeConditionText('a lovely shirt')).toBeNull();
  });

  it('recognises a bare "Good" embedded in a longer description', () => {
    expect(gradeConditionText('Arsenal Track Jacket Size XL Good')).toBe('Good');
  });
});

describe('detectColours', () => {
  it('finds the main two distinct colours in order of appearance', () => {
    const found = detectColours('Arsenal Home Shirt Red White 2020-21');
    expect(found.map((c) => c.canonical)).toEqual(['Red', 'White']);
  });

  it('prefers a longer specific phrase over its bare form', () => {
    const found = detectColours('Chelsea Sky Blue Away Shirt');
    expect(found[0]).toEqual({ raw: 'sky blue', canonical: 'Blue (Sky)' });
  });

  it('does not repeat the same colour twice', () => {
    const found = detectColours('Red shirt, red trim, White sleeves');
    expect(found.map((c) => c.canonical)).toEqual(['Red', 'White']);
  });

  it('stops at the requested max even when more colours are mentioned', () => {
    const found = detectColours('Red White Blue Shirt', 2);
    expect(found).toHaveLength(2);
  });

  it('surfaces an unmapped colour as unmapped rather than dropping it silently', () => {
    const found = detectColours('Teal and Turquoise Shirt');
    expect(found[0]).toEqual({ raw: 'teal', canonical: null });
  });
});

describe('detectStockStatus', () => {
  it('treats a quantity of 0 as out of stock regardless of text', () => {
    expect(detectStockStatus('Add to cart', 0)).toBe('Out of Stock');
  });

  it('treats a positive quantity as in stock', () => {
    expect(detectStockStatus(null, 3)).toBe('In Stock');
  });

  it('recognises "sold out" / "out of stock" text', () => {
    expect(detectStockStatus('SOLD OUT')).toBe('Out of Stock');
    expect(detectStockStatus('Currently out of stock')).toBe('Out of Stock');
  });

  it('recognises "in stock" / add-to-cart text', () => {
    expect(detectStockStatus('In Stock - ships today')).toBe('In Stock');
    expect(detectStockStatus('Add to Basket')).toBe('In Stock');
  });

  it('prefers "sold out" over a lingering add-to-cart button', () => {
    expect(detectStockStatus('Add to Cart (Sold Out)')).toBe('Out of Stock');
  });

  it('returns null rather than guessing when there is no signal at all', () => {
    expect(detectStockStatus('A lovely vintage shirt')).toBeNull();
  });
});

describe('buildKickioProfile', () => {
  it('maps a full worked example (Man Utd 2012-13 away shirt) matching the guide', () => {
    const profile = buildKickioProfile({
      url: 'https://www.ebay.co.uk/itm/123456789',
      marketplace: 'ebay',
      title: 'Manchester United 2012-13 Away Shirt Rooney #10 Nike Size L Very Good',
      images: ['https://i.ebayimg.com/images/g/abc/s-l1600.jpg'],
      price: 44.99,
      currency: 'GBP',
      extracted: { team: 'Manchester United' },
    });

    expect(profile.category).toBe('Football Shirts');
    expect(profile.identity.team).toBe('Manchester United');
    expect(profile.identity.season).toBe('2012-13');
    expect(profile.identity.shirt_type).toBe('Away');
    expect(profile.identity.gender).toBe('Mens');
    expect(profile.identity.issue).toBe('Standard Retail Version');
    expect(profile.identity.special_edition).toBe('Not A Special Edition');
    expect(profile.identity.sleeves).toBe('Short-Sleeved');
    expect(profile.identity.signed).toBe('Not Signed');
    expect(profile.identity.player).toBe('Rooney');
    expect(profile.identity.number).toBe('10');
    expect(profile.listing.condition).toBe('Very Good');
    expect(profile.listing.size).toBe('L');
    expect(profile.listing.manufacturer).toBe('Nike');
    expect(profile.confidence.team).toBe('certain');
    expect(profile.confidence.season).toBe('certain');
    expect(profile.needs_review).toBe(false);
  });

  it('maps a jacket example with the jacket-shaped identity (no shirt_type/issue/sleeves/player/number)', () => {
    const profile = buildKickioProfile({
      url: 'https://www.vinted.co.uk/items/987654321',
      marketplace: 'vinted',
      title: 'Arsenal 2020-21 Blue Adidas Track Jacket Size XL Good',
      images: ['https://images1.vinted.net/t/abc.jpg'],
      price: 65,
      currency: 'GBP',
      extracted: { team: 'Arsenal', category: 'Jackets/Coats', jacketStyle: 'Track Jacket' },
    });

    expect(profile.category).toBe('Jackets/Coats');
    expect(profile.identity.shirt_type).toBeNull();
    expect(profile.identity.issue).toBeNull();
    expect(profile.identity.sleeves).toBeNull();
    expect(profile.identity.player).toBeNull();
    expect(profile.identity.number).toBeNull();
    expect(profile.identity.season).toBe('2020-21');
    expect(profile.listing.colour).toBe('Blue');
    expect(profile.custom_attributes['jacket-style']).toBe('Track Jacket');
    expect(profile.confidence['custom_attributes.jacket-style']).toBe('certain');
  });

  it('detects the main two colours from free text when no explicit colour field is given', () => {
    const profile = buildKickioProfile({
      url: 'https://example.com/item/colours',
      title: 'Arsenal 2020-21 Red White Home Shirt',
      extracted: { team: 'Arsenal' },
    });
    expect(profile.listing.colour).toBe('Red');
    expect(profile.listing.colour_secondary).toBe('White');
  });

  it('splits an explicit comma/slash-separated colour field into the two mapped colours', () => {
    const profile = buildKickioProfile({
      url: 'https://example.com/item/colours-2',
      title: 'Arsenal 2020-21 Home Shirt',
      extracted: { team: 'Arsenal', colour: 'Red/White' },
    });
    expect(profile.listing.colour).toBe('Red');
    expect(profile.listing.colour_secondary).toBe('White');
  });

  it('reports stock status from a quantity of 0, an explicit field, or page text - never guessed', () => {
    const outOfStockByQuantity = buildKickioProfile({
      url: 'https://example.com/item/stock-1',
      title: 'Arsenal 2020-21 Home Shirt',
      extracted: { team: 'Arsenal' },
      quantity: 0,
    });
    expect(outOfStockByQuantity.listing.stock_status).toBe('Out of Stock');

    const outOfStockByField = buildKickioProfile({
      url: 'https://example.com/item/stock-2',
      title: 'Arsenal 2020-21 Home Shirt',
      extracted: { team: 'Arsenal', availability: 'Out of stock' },
    });
    expect(outOfStockByField.listing.stock_status).toBe('Out of Stock');

    const inStock = buildKickioProfile({
      url: 'https://example.com/item/stock-3',
      title: 'Arsenal 2020-21 Home Shirt - In Stock',
      extracted: { team: 'Arsenal' },
    });
    expect(inStock.listing.stock_status).toBe('In Stock');

    const unknown = buildKickioProfile({
      url: 'https://example.com/item/stock-4',
      title: 'Arsenal 2020-21 Home Shirt',
      extracted: { team: 'Arsenal' },
    });
    expect(unknown.listing.stock_status).toBeNull();
  });

  it('never invents a team - flags for review instead of guessing when nothing is recoverable', () => {
    const profile = buildKickioProfile({
      url: 'https://example.com/item/1',
      title: '2020-21 Home Shirt Size L',
    });
    expect(profile.identity.team).toBeNull();
    expect(profile.needs_review).toBe(true);
    expect(profile.review_reason).toMatch(/team/);
  });

  it('leaves an unmapped colour blank and flags it, rather than guessing the nearest colour', () => {
    const profile = buildKickioProfile({
      url: 'https://example.com/item/2',
      title: 'Some Team 2020-21 Home Shirt',
      extracted: { team: 'Some Team', colour: 'Turquoise' },
    });
    expect(profile.listing.colour).toBeNull();
    expect(profile.needs_review).toBe(true);
    expect(profile.review_reason).toMatch(/colour/);
  });

  it('passes an unrecognised manufacturer through unchanged rather than forcing "Other"', () => {
    const profile = buildKickioProfile({
      url: 'https://example.com/item/3',
      title: 'Some Team 2020-21 Home Shirt',
      extracted: { team: 'Some Team', manufacturer: 'Totally Unknown Brand' },
    });
    expect(profile.listing.manufacturer).toBe('Totally Unknown Brand');
  });
});
