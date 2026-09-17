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
  retailerHostname,
  RETAILER_CONDITION_OVERRIDES,
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

  it('keeps the extra season from a single two-year-span range like "1998-00"', () => {
    // Regression: a lone "YYYY-YY" range spanning more than one season was
    // being re-normalized from its own collapsed season string, silently
    // dropping the extra season it had already correctly computed.
    const r = extractSeason('1998-00 Nigeria Home Shirt L');
    expect(r.season).toBe('1998-99');
    expect(r.extraSeasons).toEqual(['1999-00']);
  });

  it('does the same via extractSeasonSpan (the function actually used for titles)', () => {
    const r = extractSeasonSpan('1998-00 Nigeria Home Shirt L');
    expect(r.season).toBe('1998-99');
    expect(r.extraSeasons).toEqual(['1999-00']);
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

  it('strips a spelled-out size word, and the stray punctuation left behind by removing it', () => {
    // The real title from a live Vinted listing (via Re-scrape): the
    // season and the size are separated by a period, not a space, so once
    // "20/21" is stripped the leftover "." was sitting right in front of
    // "Small" - previously surviving as "Ajax . Small" because only the
    // abbreviated size forms (XS/XL/etc) were stripped, never the spelled-
    // out ones a real seller actually typed.
    expect(guessTeamFromTitle('Adidas Ajax away top 20/21. Small mens')).toBe('Ajax');
  });

  it('strips Medium and Large the same way', () => {
    expect(guessTeamFromTitle('Liverpool Home Shirt Medium')).toBe('Liverpool');
    expect(guessTeamFromTitle('Arsenal Away Shirt Large')).toBe('Arsenal');
  });

  it('strips a colour word sitting between the team name and the kit type', () => {
    // The real title from a live Vinted listing: "Pink" is a colour
    // qualifier, not part of the team name, but nothing was stripping it -
    // it survived as "Arsenal Pink" the same way an unstripped size word
    // used to leak through before that was fixed above.
    expect(guessTeamFromTitle('Arsenal Pink Third Shirt 22/23 Small')).toBe('Arsenal');
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

  it('maps onto Kickio\'s 5-tier ladder only - no "Fair" tier', () => {
    expect(gradeConditionText('Fair condition, some wear')).toBe('Needs Attention');
    expect(gradeConditionText('Acceptable condition')).toBe('Needs Attention');
    expect(gradeConditionText('Satisfactory')).toBe('Needs Attention');
    expect(gradeConditionText('5/10 condition')).toBe('Needs Attention');
  });

  it('lets a retailer-specific override outrank the generic ladder', () => {
    RETAILER_CONDITION_OVERRIDES['test-retailer.example.com'] = [
      [/\bgrade a\b/i, 'Mint'],
      [/\bgrade b\b/i, 'Good'],
    ];
    try {
      expect(gradeConditionText('Grade A - as new', 'test-retailer.example.com')).toBe('Mint');
      expect(gradeConditionText('Grade B', 'test-retailer.example.com')).toBe('Good');
      // No override for this host - falls through to the generic ladder.
      expect(gradeConditionText('Grade A', 'other-retailer.example.com')).toBeNull();
    } finally {
      delete RETAILER_CONDITION_OVERRIDES['test-retailer.example.com'];
    }
  });
});

describe('vintagefootballshirts.com condition mapping', () => {
  const host = 'vintagefootballshirts.com';

  it('maps every confirmed VFS condition facet to the right Kickio grade', () => {
    expect(gradeConditionText('BNIB', host)).toBe('Brand New (With Tags)');
    expect(gradeConditionText('w/tags', host)).toBe('Brand New (With Tags)');
    expect(gradeConditionText('Mint', host)).toBe('Mint');
    expect(gradeConditionText('As New', host)).toBe('Mint');
    expect(gradeConditionText('Excellent', host)).toBe('Very Good');
    expect(gradeConditionText('Very good', host)).toBe('Very Good');
    expect(gradeConditionText('Very Good', host)).toBe('Very Good');
    expect(gradeConditionText('Good', host)).toBe('Good');
  });

  it("checks 'Very Good' before the bare 'Good' it would otherwise also match", () => {
    expect(gradeConditionText('Condition: Very Good', host)).toBe('Very Good');
  });

  it('applies via the "www." host too, since buildKickioProfile strips it before lookup', () => {
    const profile = buildKickioProfile({
      url: 'https://www.vintagefootballshirts.com/products/1983-85-aston-villa-home-shirt-m-3314',
      title: '1983-85 Aston Villa Home Shirt M',
      extracted: { team: 'Aston Villa', condition: 'Excellent' },
    });
    expect(profile.listing.condition).toBe('Very Good');
  });
});

describe('retailerHostname', () => {
  it('extracts a lowercase hostname with "www." stripped', () => {
    expect(retailerHostname('https://www.VintageFootballShirts.com/products/x')).toBe(
      'vintagefootballshirts.com',
    );
    expect(retailerHostname('https://preview-test.example.com/shirt/1')).toBe('preview-test.example.com');
  });

  it('returns null for missing or unparseable input', () => {
    expect(retailerHostname(null)).toBeNull();
    expect(retailerHostname(undefined)).toBeNull();
    expect(retailerHostname('not a url')).toBeNull();
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

  it('returns null when there is no text to check at all', () => {
    expect(detectStockStatus(null)).toBeNull();
    expect(detectStockStatus('')).toBeNull();
  });

  it('returns "Unknown" rather than guessing when there is text but no signal in it', () => {
    expect(detectStockStatus('A lovely vintage shirt')).toBe('Unknown');
  });

  it('recognises a bare "SOLD" or "Reserved" marketplace marker', () => {
    expect(detectStockStatus('Arsenal Home Shirt M - SOLD')).toBe('Out of Stock');
    expect(detectStockStatus('Reserved for John')).toBe('Out of Stock');
  });

  it('recognises "X left/remaining/in stock/available" counts, either way', () => {
    expect(detectStockStatus('Only 1 left')).toBe('In Stock');
    expect(detectStockStatus('3 in stock')).toBe('In Stock');
    expect(detectStockStatus('2 remaining')).toBe('In Stock');
    expect(detectStockStatus('0 available')).toBe('Out of Stock');
  });

  it('recognises "last one" style urgency phrasing as in stock', () => {
    expect(detectStockStatus('Last one! Buy now')).toBe('In Stock');
    expect(detectStockStatus('Only one left in this size')).toBe('In Stock');
  });

  it('recognises schema.org Offer.availability values, URL or bare token', () => {
    expect(detectStockStatus('https://schema.org/OutOfStock')).toBe('Out of Stock');
    expect(detectStockStatus('https://schema.org/InStock')).toBe('In Stock');
    expect(detectStockStatus('OutOfStock')).toBe('Out of Stock');
    expect(detectStockStatus('InStock')).toBe('In Stock');
  });

  it('recognises further common phrasing (no longer available, reserved, ended)', () => {
    expect(detectStockStatus('This listing has ended')).toBe('Out of Stock');
    expect(detectStockStatus('No longer available')).toBe('Out of Stock');
    expect(detectStockStatus('Still available - message to buy')).toBe('In Stock');
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

  it('maps a shirt spanning two seasons (real example: "1998-00 Nigeria Home Shirt L")', () => {
    const profile = buildKickioProfile({
      url: 'https://www.vintagefootballshirts.com/products/1998-00-nigeria-home-shirt-l',
      title: '1998-00 Nigeria Home Shirt L',
      extracted: { team: 'Nigeria' },
    });
    expect(profile.identity.season).toBe('1998-99');
    expect(profile.identity.extra_seasons).toEqual(['1999-00']);
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

  it("uses a retailer's own condition wording (from the item's URL) over the generic ladder", () => {
    RETAILER_CONDITION_OVERRIDES['grading-retailer.example.com'] = [[/\bgrade a\b/i, 'Mint']];
    try {
      const profile = buildKickioProfile({
        url: 'https://grading-retailer.example.com/products/arsenal-home',
        title: 'Arsenal 2020-21 Home Shirt',
        extracted: { team: 'Arsenal', condition: 'Grade A' },
      });
      expect(profile.listing.condition).toBe('Mint');
    } finally {
      delete RETAILER_CONDITION_OVERRIDES['grading-retailer.example.com'];
    }
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
    expect(unknown.listing.stock_status).toBe('Unknown');

    const noContent = buildKickioProfile({
      url: 'https://example.com/item/stock-5',
      extracted: { team: 'Arsenal' },
    });
    expect(noContent.listing.stock_status).toBeNull();
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

  describe('GBP price conversion', () => {
    it('converts a USD price to GBP using the configured rate, keeping the original for reference', () => {
      const profile = buildKickioProfile({
        url: 'https://example.com/item/usd-1',
        title: 'Some Team 2020-21 Home Shirt',
        extracted: { team: 'Some Team' },
        price: 59.99,
        currency: 'USD',
        currencyRates: { USD: 0.75 },
      });
      expect(profile.listing.price).toBeCloseTo(44.99, 2);
      expect(profile.listing.currency).toBe('GBP');
      expect(profile.listing.original_price).toBe(59.99);
      expect(profile.listing.original_currency).toBe('USD');
      expect(profile.listing.fx_rate_used).toBe(0.75);
      expect(profile.confidence.price).toBe('inferred');
    });

    it('leaves a price as-scraped, and flags for review, when no rate is configured for its currency', () => {
      const profile = buildKickioProfile({
        url: 'https://example.com/item/cad-1',
        title: 'Some Team 2020-21 Home Shirt',
        extracted: { team: 'Some Team' },
        price: 79.99,
        currency: 'CAD',
        currencyRates: { USD: 0.75 },
      });
      expect(profile.listing.price).toBe(79.99);
      expect(profile.listing.currency).toBe('CAD');
      expect(profile.listing.original_price).toBeNull();
      expect(profile.listing.original_currency).toBeNull();
      expect(profile.listing.fx_rate_used).toBeNull();
      expect(profile.needs_review).toBe(true);
      expect(profile.review_reason).toMatch(/no GBP conversion rate configured for currency "CAD"/);
    });

    it('does nothing when the price is already GBP, even with rates configured', () => {
      const profile = buildKickioProfile({
        url: 'https://example.com/item/gbp-1',
        title: 'Some Team 2020-21 Home Shirt',
        extracted: { team: 'Some Team' },
        price: 44.99,
        currency: 'GBP',
        currencyRates: { USD: 0.75 },
      });
      expect(profile.listing.price).toBe(44.99);
      expect(profile.listing.currency).toBe('GBP');
      expect(profile.listing.original_price).toBeNull();
      expect(profile.listing.original_currency).toBeNull();
      expect(profile.listing.fx_rate_used).toBeNull();
      expect(profile.confidence.price).toBeUndefined();
    });

    it('does nothing when there is no price at all - nothing to convert', () => {
      const profile = buildKickioProfile({
        url: 'https://example.com/item/no-price',
        title: 'Some Team 2020-21 Home Shirt',
        extracted: { team: 'Some Team' },
        currency: 'USD',
        currencyRates: { USD: 0.75 },
      });
      expect(profile.listing.price).toBeNull();
      expect(profile.listing.original_price).toBeNull();
      expect(profile.needs_review).toBe(false);
    });

    it('matches the currency code case-insensitively against the rates map', () => {
      const profile = buildKickioProfile({
        url: 'https://example.com/item/usd-lower',
        title: 'Some Team 2020-21 Home Shirt',
        extracted: { team: 'Some Team' },
        price: 100,
        currency: 'usd',
        currencyRates: { USD: 0.8 },
      });
      expect(profile.listing.price).toBe(80);
      expect(profile.listing.currency).toBe('GBP');
    });
  });

  describe('price text fallback', () => {
    // The motivating case: a JS-rendered marketplace (Vinted) whose price
    // never lands in a JSON-LD block or meta tag, only in the page's own
    // visible text - so this is the last resort, tried only once both an
    // explicit price field and structured product data have come up empty.
    it('reads a £-prefixed price from the description when nothing else provided one', () => {
      const profile = buildKickioProfile({
        url: 'https://vinted.co.uk/items/1',
        title: 'Man City home shirt 2020/21 - Nike, size L',
        description: 'Great condition\n£25.00\nSize: L',
      });
      expect(profile.listing.price).toBe(25);
      expect(profile.listing.currency).toBe('GBP');
      expect(profile.confidence.price).toBe('inferred');
      expect(profile.needs_review).toBe(true);
      expect(profile.review_reason).toMatch(/price read from page text/);
    });

    it('reads a $-prefixed price and a currency-code price', () => {
      expect(
        buildKickioProfile({ url: 'https://example.com/1', description: 'Selling for $30' }).listing.price,
      ).toBe(30);
      expect(
        buildKickioProfile({ url: 'https://example.com/1', description: 'Selling for $30' }).listing.currency,
      ).toBe('USD');
      const eur = buildKickioProfile({ url: 'https://example.com/2', description: '25.00 EUR shipped' });
      expect(eur.listing.price).toBe(25);
      expect(eur.listing.currency).toBe('EUR');
    });

    it('never overrides an explicit price or structured product data with the text fallback', () => {
      const profile = buildKickioProfile({
        url: 'https://example.com/item',
        description: 'Was £50, now £25.00',
        price: 44.99,
        currency: 'GBP',
      });
      expect(profile.listing.price).toBe(44.99);
      expect(profile.confidence.price).toBeUndefined();
    });

    it('leaves price null, without flagging price for review, when no price text is found anywhere', () => {
      const profile = buildKickioProfile({
        url: 'https://example.com/item',
        title: 'Some Team 2020-21 Home Shirt',
        extracted: { team: 'Some Team' },
      });
      expect(profile.listing.price).toBeNull();
      expect(profile.needs_review).toBe(false);
    });
  });
});
