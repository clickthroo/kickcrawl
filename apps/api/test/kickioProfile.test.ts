import { describe, expect, it } from 'vitest';
import {
  buildKickioProfile,
  detectColours,
  detectShirtType,
  detectStockStatus,
  extractPlayerNameFromTitle,
  extractPlayerNumber,
  extractSeason,
  extractSeasonSpan,
  extractSizeFromTitle,
  gradeConditionText,
  guessTeamFromTitle,
  normalizePlayerName,
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

  it('strips a quoted special-edition aside rather than leaking it into the team', () => {
    // Confirmed against a real vintagefootballshirts.com listing - the
    // quoted trophy name was surviving verbatim (plus a stray SKU-shaped
    // number split off the site's own product code) leaving
    // "Sevilla 'Antonio Puerta Trophy' 83" where only "Sevilla" is real.
    expect(guessTeamFromTitle("2019 Sevilla Nike 'Antonio Puerta Trophy' Home Shirt")).toBe('Sevilla');
  });

  it('leaves an apostrophe inside a real word alone (not mistaken for a quoted span)', () => {
    expect(guessTeamFromTitle("N'Golo's 2018 France Home Shirt")).toBe("N'Golo's France");
  });

  it('strips a trailing stock/reference code, and the size letter it displaced from the end', () => {
    // The real title from a live vintagefootballshirts.com listing - "S"
    // used to survive as part of the guess because the site's own 6-digit
    // stock code came after it, pushing "S" away from the very end where
    // the bare-size-letter cleanup only ever looked.
    expect(guessTeamFromTitle('2003-05 Barcelona Nike Training Shirt S 112587')).toBe('Barcelona');
  });

  it('leaves a real, short club number alone - only a long stock-code-shaped number is stripped', () => {
    expect(guessTeamFromTitle('Hannover 96 Home Shirt 2019-20')).toBe('Hannover 96');
  });

  it('strips a short trailing stock code that a digit-length threshold alone could never safely catch', () => {
    // Real title from a live listing: "Team: Celtic 47" was leaking
    // through - the digit-length-based strip above requires 5+ digits
    // specifically so it can never mistake a real club number
    // (Hannover 96) for a stock code, but that same restraint meant a
    // short code like this bare "47" survived untouched. Anchoring to
    // the size word immediately before it (present in the real title)
    // is what makes this one safe to strip despite being just 2 digits.
    expect(guessTeamFromTitle('2012-13 Celtic Nike Home Shirt XL 47')).toBe('Celtic');
  });

  it('strips an alphanumeric trailing stock code the same way', () => {
    // Real title from a live listing: "Team: Celtic M HA8318" - "M" isn't
    // in the abbreviated XL/XXL/... list stripped early, so it survived
    // all the way to the end, and the purely-numeric stock-code strip
    // above can't match a letter-prefixed code like this at all.
    expect(guessTeamFromTitle('2022-23 Celtic adidas Third Shirt M HA8318')).toBe('Celtic');
  });

  it('strips a colour word sitting between the team name and the kit type', () => {
    // The real title from a live Vinted listing: "Pink" is a colour
    // qualifier, not part of the team name, but nothing was stripping it -
    // it survived as "Arsenal Pink" the same way an unstripped size word
    // used to leak through before that was fixed above.
    expect(guessTeamFromTitle('Arsenal Pink Third Shirt 22/23 Small')).toBe('Arsenal');
  });
});

describe('extractPlayerNumber', () => {
  it('reads a "#10"-style number', () => {
    expect(extractPlayerNumber('Man Utd Away Shirt Rooney #10')).toBe('10');
  });

  it('reads a bare trailing "Name Number" with no "#" at all - the common Vinted shape', () => {
    expect(extractPlayerNumber('Man Utd Away Shirt Beckham 7')).toBe('7');
  });

  it('reads a number after an accented surname - previously broke the match entirely', () => {
    // The trailing-name regex used to exclude accented letters (À-ÿ)
    // outright, so a name like "Müller" broke the match before ever
    // reaching the number after it, not just its own extraction.
    expect(extractPlayerNumber('Bayern Home Shirt Müller 25')).toBe('25');
  });

  it('does not mistake a trailing size/noise word for a player name', () => {
    expect(extractPlayerNumber('Man Utd Away Shirt 10')).toBeNull();
  });

  it('reads "No.10", "No 10", and "Number 10" as the same marker as "#10"', () => {
    expect(extractPlayerNumber('Man Utd Away Shirt Rooney No.10')).toBe('10');
    expect(extractPlayerNumber('Man Utd Away Shirt Rooney No 10')).toBe('10');
    expect(extractPlayerNumber('Man Utd Away Shirt Rooney Number 10')).toBe('10');
    expect(extractPlayerNumber('Man Utd Away Shirt Rooney Squad Number 10')).toBe('10');
  });

  it('finds a marked number anywhere in the title, not just at the very end', () => {
    // Unlike the bare/unmarked shape, an explicit marker ("#", "No.",
    // "Number") is unambiguous enough to search for anywhere, not just
    // require it be the literal last thing in the title.
    expect(extractPlayerNumber('Rooney #10 Man Utd Away Shirt Size L')).toBe('10');
  });

  it('does not mistake a marketplace trust badge ("No.1 seller") for a squad number', () => {
    expect(extractPlayerNumber('No.1 seller! Man Utd Away Shirt')).toBeNull();
    expect(extractPlayerNumber('Number 1 rated seller - Arsenal Home Shirt')).toBeNull();
  });
});

describe('extractPlayerNameFromTitle', () => {
  it('reads a multi-word name from a "#10"-style title', () => {
    expect(extractPlayerNameFromTitle('Man Utd Away Shirt Cristiano Ronaldo #7')).toBe('Cristiano Ronaldo');
  });

  it('reads a bare trailing "Name Number" with no "#" at all - the common Vinted shape', () => {
    // Previously only the "#" pattern was supported, so this exact real-
    // world shape - a plain single-surname back print typed straight into
    // the title - found the number (extractPlayerNumber already accepted
    // it) but silently dropped the name half of the same listing.
    expect(extractPlayerNameFromTitle('Man Utd Away Shirt Beckham 7')).toBe('Beckham');
  });

  it('reads an accented surname from the bare trailing shape', () => {
    expect(extractPlayerNameFromTitle('Bayern Home Shirt Müller 25')).toBe('Müller');
  });

  it('returns null rather than a trailing size/noise word', () => {
    expect(extractPlayerNameFromTitle('Man Utd Away Shirt 10')).toBeNull();
  });

  it('reads a multi-word name before "No.10"/"Number 10"/"Squad Number 10" the same as "#10"', () => {
    expect(extractPlayerNameFromTitle('Man Utd Away Shirt Del Piero No.10')).toBe('Del Piero');
    expect(extractPlayerNameFromTitle('Man Utd Away Shirt Del Piero Number 10')).toBe('Del Piero');
    expect(extractPlayerNameFromTitle('Man Utd Away Shirt Del Piero Squad Number 10')).toBe('Del Piero');
  });

  it('finds the name before a marked number anywhere in the title, not just at the very end', () => {
    expect(extractPlayerNameFromTitle('Rooney #10 Man Utd Away Shirt Size L')).toBe('Rooney');
  });

  it('returns null for a marked number with no real name before it, rather than a leftover club-suffix word', () => {
    // "Utd" isn't a player name - it's what's left of the team mention
    // immediately before the marker when there's no actual player name
    // in the title at all (a blank/number-only shirt).
    expect(extractPlayerNameFromTitle('Man Utd Away Shirt #7')).toBeNull();
  });

  it('does not mistake a marketplace trust badge ("No.1 seller") for a player name', () => {
    expect(extractPlayerNameFromTitle('No.1 seller! Man Utd Away Shirt')).toBeNull();
  });
});

describe('normalizePlayerName', () => {
  it('title-cases an all-caps name, the normal case for a shirt back print copied verbatim', () => {
    expect(normalizePlayerName('Man Utd', 'BECKHAM')).toBe('Beckham');
    expect(normalizePlayerName(null, 'CRISTIANO RONALDO')).toBe('Cristiano Ronaldo');
  });

  it('leaves already mixed-case input untouched rather than re-casing it', () => {
    expect(normalizePlayerName(null, 'van Dijk')).toBe('van Dijk');
    expect(normalizePlayerName(null, 'McTominay')).toBe('McTominay');
  });

  it('still strips a leading team-name mention before applying case normalization', () => {
    expect(normalizePlayerName('Manchester United', 'MANCHESTER UNITED BECKHAM')).toBe('Beckham');
  });

  it('returns null rather than a leftover team-name fragment when the candidate is entirely team tokens', () => {
    // Regression: the team-token strip used to stop as soon as one word
    // was left, even if that one word was ALSO a team token - so a
    // captured "Man Utd" (no real player name at all) resolved to the
    // leftover "Utd" instead of correctly being recognized as no name.
    expect(normalizePlayerName('Man Utd', 'Man Utd')).toBeNull();
    expect(normalizePlayerName('Man Utd', 'Utd')).toBeNull();
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

  it('reads a player name and number from a Vinted-style title - all-caps back print, no "#"', () => {
    // The two things wrong with this exact shape before this fix: the
    // bare "Name Number" tail (no "#") was never checked for a name at
    // all, and even if it had been, "BECKHAM" would have surfaced as
    // shouted text instead of the normal way a person writes a name.
    const profile = buildKickioProfile({
      url: 'https://www.vinted.co.uk/items/1-man-utd-away-shirt-beckham-7',
      title: 'Man Utd Away Shirt Size L BECKHAM 7',
      extracted: { team: 'Manchester United' },
    });
    expect(profile.identity.player).toBe('Beckham');
    expect(profile.identity.number).toBe('7');
  });

  it('falls back to the description for player name/number when the title alone has nothing', () => {
    // Same "title first, then widen only on a miss" strategy already
    // used for season parsing - a player name/number is almost always in
    // the title when it's anywhere at all, so the description (the
    // page's own markdown, not a clean product description) is only
    // ever consulted once the title has genuinely come up empty.
    const profile = buildKickioProfile({
      url: 'https://www.vinted.co.uk/items/1-man-utd-away-shirt',
      title: 'Man Utd Away Shirt Size L',
      description: 'Great shirt! Rooney #10 printed on the back. No flaws.',
      extracted: { team: 'Manchester United' },
    });
    expect(profile.identity.player).toBe('Rooney');
    expect(profile.identity.number).toBe('10');
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

  it('finds the season in the title even when the page markdown\'s own boilerplate looks like a conflicting one', () => {
    // Real bug, from a real Vinted item: the description passed in here is
    // the actual page's own boilerplate legal footer (present on every
    // Vinted item page). Its two legislation citation URLs -
    // ".../regulation/29)" preceded by "2013" and "/3134", and
    // ".../2015/15/contents/enacted" - each look like a "YYYY-YY" season
    // range to the same regex used on titles, and normalize to two
    // DIFFERENT base seasons ("2013-14" and "2015-16"). Scanning the whole
    // haystack in one pass treated that as a genuine multi-season
    // conflict and bailed to blank, even though the title's own "22/23"
    // was completely unambiguous on its own.
    const description = `Arsenal Pink Third Shirt 22/23 Small · Very good
Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013 (section 29(1) of the Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013)
right to reject (section 20 of the Consumer Rights Act) does not apply, see https://www.legislation.gov.uk/uksi/2013/3134/regulation/29
Consumer Rights Act 2015, see https://www.legislation.gov.uk/ukpga/2015/15/contents/enacted`;
    const profile = buildKickioProfile({
      url: 'https://www.vinted.co.uk/items/10033708688-arsenal-pink-third-shirt-2223-small',
      title: 'Arsenal Pink Third Shirt 22/23 Small | Vinted',
      description,
      extracted: null,
    });
    expect(profile.identity.season).toBe('2022-23');
    expect(profile.confidence.season).toBe('certain');
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

describe('buildKickioProfile - keyword fields ignore page boilerplate outside the title', () => {
  // Confirmed in production on vintagefootballshirts.com: getContentHtml()
  // (services/mainContent.ts) only strips literal <nav>/<header>/<footer>
  // tags, and this retailer's Shopify theme - like many - wraps its real
  // nav/footer in plain <div>s instead, so sitewide boilerplate ("Shop by
  // Player", a hidden locale switcher mentioning "cuarta equipación", a
  // newsletter "you have successfully signed up" toast) survives into
  // every page's markdown. type/issue/signed/special_edition/boxed/
  // sleeves/gender each have a "default when nothing found" - Home,
  // Standard Retail Version, Not Signed, etc - so a false match from that
  // boilerplate doesn't just add noise, it silently overrides an
  // otherwise-correct default. Every case below uses a title with no
  // relevant keyword at all, paired with a description standing in for
  // exactly that kind of contaminated haystack, to prove these fields no
  // longer look past the title for them.
  const boilerplateDescription =
    'Shop by Player. Free UK & Europe shipping. Camiseta de la cuarta equipación. ' +
    'You have successfully signed up to our newsletter. Boxing Day sale now on. ' +
    "Women's sizing guide. New arrivals every week.";

  it('does not tag an ordinary replica as Authentic/Player Version from a sitewide "Shop by Player" link', () => {
    const profile = buildKickioProfile({
      url: 'https://www.vintagefootballshirts.com/products/1998-arsenal-nike-home-shirt',
      title: '1998 Arsenal Nike Home Shirt',
      description: boilerplateDescription,
      extracted: { team: 'Arsenal' },
    });
    expect(profile.identity.issue).toBe('Standard Retail Version');
  });

  it('does not misdetect shirt type from unrelated page text (the real Boca Juniors away-shirt repro)', () => {
    const profile = buildKickioProfile({
      url: 'https://www.vintagefootballshirts.com/products/2005-boca-juniors-nike-away-shirt',
      title: '2005 Boca Juniors Nike Away Shirt',
      description: boilerplateDescription,
      extracted: { team: 'Boca Juniors' },
    });
    expect(profile.identity.shirt_type).toBe('Away');
  });

  it('does not mark an item Signed from unrelated newsletter boilerplate ("signed up")', () => {
    const profile = buildKickioProfile({
      url: 'https://www.vintagefootballshirts.com/products/2010-brazil-nike-home-shirt',
      title: '2010 Brazil Nike Home Shirt',
      description: boilerplateDescription,
      extracted: { team: 'Brazil' },
    });
    expect(profile.identity.signed).toBe('Not Signed');
  });

  it('does not tag an item Boxed from unrelated "Boxing Day sale" boilerplate', () => {
    const profile = buildKickioProfile({
      url: 'https://www.vintagefootballshirts.com/products/2015-chelsea-adidas-away-shirt',
      title: '2015 Chelsea Adidas Away Shirt',
      description: boilerplateDescription,
      extracted: { team: 'Chelsea' },
    });
    expect(profile.listing.boxed_edition).toBe('Not A Boxed Edition');
  });

  it('does not tag an item Womens from an unrelated sizing-guide link', () => {
    const profile = buildKickioProfile({
      url: 'https://www.vintagefootballshirts.com/products/2012-germany-adidas-home-shirt',
      title: '2012 Germany Adidas Home Shirt',
      description: boilerplateDescription,
      extracted: { team: 'Germany' },
    });
    expect(profile.identity.gender).toBe('Mens');
  });

  it('still recovers a genuine title-stated signal (Player Issue really is in the title)', () => {
    // The point of scoping to the title isn't "never trust the word
    // player" - it's that the title is reliably about THIS item. This
    // retailer's own titles already say so explicitly when it's true.
    const profile = buildKickioProfile({
      url: 'https://www.vintagefootballshirts.com/products/2023-24-england-nike-player-issue-pre-match-shirt',
      title: '2023-24 England Nike Player Issue Pre-Match Shirt',
      description: boilerplateDescription,
      extracted: { team: 'England' },
    });
    expect(profile.identity.issue).toBe('Authentic/Player Version');
  });
});
