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
  extractSizeFromVariant,
  gradeConditionText,
  guessTeamFromTitle,
  matchKickioTeam,
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

  it('names the actual defaulted type ("GK Home") in buildKickioProfile\'s review reason, not a hardcoded "Home"', () => {
    // Real title: "2022-23 Manchester United adidas Goalkeeper Shirt M
    // H64059" has no Home/Away/Third/Fourth qualifier, so detectShirtType
    // correctly defaults it to "GK Home" (asserted above) - but the
    // review-reason message buildKickioProfile pushed for any uncertain
    // type was a hardcoded "...type defaulted to Home" regardless of what
    // r.type actually was, misleading a reviewer on every such goalkeeper
    // listing.
    const profile = buildKickioProfile({
      url: 'https://www.vintagefootballshirts.com/products/x',
      title: '2022-23 Manchester United adidas Goalkeeper Shirt M H64059',
    });
    expect(profile.identity.shirt_type).toBe('GK Home');
    expect(profile.review_reason).toContain(
      'no explicit Home/Away/Third/Fourth/GK keyword found - type defaulted to GK Home',
    );
  });

  it('resolves player to null (not the team name) on a marked-number goalkeeper shirt with no real back-print', () => {
    // Real title: "1988-90 England Goalkeeper Shirt #1 M" - with the full
    // team context buildKickioProfile has (unlike bare
    // extractPlayerNameFromTitle, tested above), normalizePlayerName
    // recognises "England" as a leftover team-name fragment, not a real
    // player, and correctly reduces it to null rather than surfacing the
    // team's own name as if it were a back-printed surname.
    const profile = buildKickioProfile({
      url: 'https://www.vintagefootballshirts.com/products/x',
      title: '1988-90 England Goalkeeper Shirt #1 M',
    });
    expect(profile.identity.player).toBeNull();
    expect(profile.identity.number).toBe('1');
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

  it('strips this retailer\'s "*w/tags*" condition note rather than leaking it into the team', () => {
    // Real title from a live vintagefootballshirts.com listing: "Team:
    // Leeds w/tags" was leaking through - the asterisks around it were
    // already stripped, but nothing recognised the bare "w/tags" token
    // itself as a condition note (this retailer's own shorthand for
    // BNWT/BNWOT) rather than part of the team name.
    expect(guessTeamFromTitle('2013-14 Leeds Macron Home Shirt *w/tags*')).toBe('Leeds');
  });

  it('strips a trailing alphanumeric stock code even with no size word in front of it to anchor on', () => {
    // Real title from a live listing: "Team: Ukraine w/tags JZ4622" -
    // unlike the earlier "Celtic M HA8318" case, there's no size word
    // between the condition note and the code for the size+code strip
    // above to anchor on, and the code isn't purely numeric either, so
    // neither existing stock-code strip could catch it.
    expect(guessTeamFromTitle('2026 Ukraine adidas Home Shirt *w/tags* JZ4622')).toBe('Ukraine');
  });

  it('leaves a real club name ending in a number alone - the new alphanumeric-code strip only matches letters fused directly onto digits', () => {
    // Guards the new stock-code strip against being too broad: it only
    // matches a couple of LETTERS immediately fused onto digits with no
    // space ("HA8318", "JZ4622"), so a genuine trailing club number - which
    // is always separated by a space, never fused onto the preceding word -
    // is never mistaken for one.
    expect(guessTeamFromTitle('Hannover 96 Away Shirt 2019-20')).toBe('Hannover 96');
  });

  it('strips a trailing stock code that comes BEFORE the size word instead of after', () => {
    // Real title from a live listing: "Team: Manchester City 77" - every
    // other stock-code strip above assumes the retailer's own code comes
    // AFTER the size ("... Shirt XL 47"), but this listing had it the
    // other way around ("... Shirt *w/tags* 77 XL"). The unconditional,
    // un-anchored abbreviated-size-word strip elsewhere in this function
    // cleanly removed the trailing "XL" on its own, but that left the "77"
    // in front of it orphaned with no size word left to anchor a strip on.
    expect(guessTeamFromTitle('2024-25 Manchester City Puma Authentic GK Home Shirt *w/tags* 77 XL')).toBe(
      'Manchester City',
    );
  });

  it('does not mistake a real word immediately before a trailing size letter for a stock code', () => {
    // Guards the new code-before-size strip against being too broad: it
    // only matches when that word contains a digit, since - unlike the
    // size-then-code direction, which is anchored by the code sitting
    // safely AFTER a known size-word boundary - a plain word here could
    // just as easily be genuinely part of the team name itself.
    expect(guessTeamFromTitle('2012-13 Celtic Home Shirt M')).toBe('Celtic');
  });

  it("strips a manufacturer's own product-line name and an all-caps trailing SKU rather than leaking either into the team", () => {
    // Real title from a live listing: "Team: Liverpool Originals LFSTLR" -
    // "Originals" is adidas's own product-line name (as in "adidas
    // Originals"), not part of the team, and "LFSTLR" is this retailer's
    // own style/SKU code, in a shape (bare letters, no digits) neither of
    // the other trailing-code strips above can match.
    expect(guessTeamFromTitle('2025-26 Liverpool adidas Originals LFSTLR Home Shirt *w/tags*')).toBe('Liverpool');
  });

  it('leaves a short, real team abbreviation in all caps alone - only a 4+ letter trailing code is stripped', () => {
    // Guards the new trailing all-caps code strip against being too
    // broad: a genuine short team abbreviation (PSG, USA) is common
    // enough as the entire team name on its own that it's deliberately
    // left below the length threshold that the style/SKU code strip uses.
    expect(guessTeamFromTitle('PSG Home Shirt')).toBe('PSG');
  });

  it('strips a manufacturer collab line rather than leaking it into the team', () => {
    // Real title from a live listing: "Team: Manchester United x George
    // Best LS" - "x George Best" names a tribute/collaboration line, not
    // the team, and "LS" is this retailer's own shorthand for long-sleeve
    // (the same thing "L/S" already covers, just without the slash).
    expect(guessTeamFromTitle('2024-25 Manchester United adidas Originals x George Best LS Shirt *w/tags*')).toBe(
      'Manchester United',
    );
  });

  it('strips a trailing alphanumeric stock code with a letter suffix, a shape the other code strips miss', () => {
    // Real title from a live listing: "Team: Plymouth PLY25001R" - the
    // existing fused letters-then-digits strip only matches when the code
    // ENDS in digits ("HA8318"), but this one has a trailing letter after
    // the digits too, so it needed a broader mixed-alphanumeric strip.
    expect(guessTeamFromTitle('2025-26 Plymouth Puma Home Shirt *BNIB* PLY25001R')).toBe('Plymouth');
    // Real title from a live listing: "Team: Northampton Town NOR25501R" -
    // same shape, confirming it's this retailer's general SKU format, not
    // a one-off.
    expect(guessTeamFromTitle('2025-26 Northampton Town Puma Home Shirt NOR25501R')).toBe('Northampton Town');
  });

  it('strips a long hash-like alphanumeric code the same way', () => {
    // Real title from a live listing: "Team: Qpr Hm0h6ca2690que" - the
    // whole title was in solid capitals, so once the code was stripped,
    // the leftover "QPR" fell under the length-3 threshold that keeps a
    // real short abbreviation (PSG, USA) untouched rather than wrongly
    // title-casing it - a better outcome than the title-cased "Qpr" the
    // original bug produced, since "QPR" is the correct form to begin
    // with.
    expect(guessTeamFromTitle('2025-26 QPR Errea Away Shirt *w/tags* HM0H6CA2690QUE')).toBe('QPR');
  });

  it('strips a paired size+code even when a noise word originally sat between them', () => {
    // Real titles from live listings surviving as "England 72" and
    // "France S 57": the size+code pairing strips above only ever ran
    // ONCE, early in the pipeline, before words like "Retro" had been
    // stripped - so when one of those words sat directly between the size
    // and the code ("XL Retro 72"), the pair wasn't adjacent yet the one
    // time the check ran, and by the time "Retro" was stripped later, the
    // size word itself had already been removed too (by the unconditional
    // size-word strip), leaving the code permanently orphaned. The
    // size+code pairing now runs after every other noise word, but still
    // before the size word's own unconditional removal.
    expect(guessTeamFromTitle('2016-17 England Nike Away Shirt *w/tags* XL Retro 72')).toBe('England');
    expect(guessTeamFromTitle('2014-15 France Nike Player Issue Home Shirt S Retro 57')).toBe('France');
    // Real title from a live listing: "Team: Tottenham M DN" - same
    // mechanism, just with the code coming after an all-letters (not
    // digit-gated) size+code pair instead of a numeric one.
    expect(guessTeamFromTitle('2022-23 Tottenham Nike Player Issue Third Shirt *w/tags* M Retro DN')).toBe(
      'Tottenham',
    );
  });

  it('does not let a bounded player-name-before-# strip eat backwards into the team name', () => {
    // Real title from a live listing that came back with NO team at all
    // ("team could not be determined from the available text"):
    // "2021-22 Wolves Castore Third Shirt Neto #7" - every word ahead of
    // "Neto #7" ("Wolves Castore Third Shirt") is ALSO capitalized in this
    // title-case listing, and the player-name-before-# strip used to be
    // unbounded, so it greedily consumed the entire capitalized run all
    // the way back through the team name too, wiping out the whole guess.
    expect(guessTeamFromTitle('2021-22 Wolves Castore Third Shirt Neto #7')).toBe('Wolves');
  });

  it("strips a manufacturer's casualwear product line and garment-type words, not just shirt-specific ones", () => {
    // Real title from a live listing: "Team: Manchester United Essentials
    // 1/4 Zip Sweatshirt" - "Essentials" is adidas's own product-line name
    // (like "Originals"), and "1/4 Zip"/"Sweatshirt" are casualwear
    // garment-type words this retailer also sells alongside match shirts,
    // neither of which the existing shirt-specific noise-word lists cover.
    expect(guessTeamFromTitle('2024-25 Manchester United adidas Essentials 1/4 Zip Sweatshirt')).toBe(
      'Manchester United',
    );
  });

  it('strips more casualwear garment words and a manufacturer product line', () => {
    // Real titles from live listings: "Team: Arsenal Graphic Tee" and
    // "Team: Liverpool Presentation Jacket" - "Tee"/"Jacket" are more
    // non-shirt garment types this retailer sells, and "Graphic"/
    // "Presentation" describe the garment style, not the team.
    expect(guessTeamFromTitle('2009-10 Arsenal Nike Graphic Tee XXL 355064-62')).toBe('Arsenal');
    expect(guessTeamFromTitle('2025-26 Liverpool adidas Presentation Jacket *w/tags*')).toBe('Liverpool');
    // Real title from a live listing: "Team: Norway Energy" - "Energy" is
    // Nike's own product-line name, the same family as adidas's
    // "Originals"/"Essentials" above.
    expect(guessTeamFromTitle('2026 Norway Nike Energy Shirt *As New* L IH1869-001')).toBe('Norway');
  });

  it('strips a short bare trailing number when a kit-type word in the raw title proves it is a stock code, not a club number', () => {
    // Real titles from live listings: "Team: Sevilla 83" and "Team:
    // Manchester City 78" - unlike every other trailing-code case above,
    // these have no adjacent size word at all to anchor a strip on, so a
    // short bare number here is genuinely ambiguous with a real club
    // number (Hannover 96) on shape alone. The distinguishing signal is
    // word ORDER in the raw title: a real club number always sits
    // immediately next to the team name, before any kit-type word: a
    // trailing number that comes AFTER one is this retailer's own stock
    // code instead.
    expect(guessTeamFromTitle("2019 Sevilla Nike 'Antonio Puerta Trophy' Home Shirt 83")).toBe('Sevilla');
    expect(guessTeamFromTitle('2025-26 Manchester City Puma Home Shirt L/S *w/tags* 78')).toBe('Manchester City');
  });

  it('leaves a bare trailing number alone when there is no kit-type word anywhere to prove it is a stock code', () => {
    // Guards the new short-bare-number strip against being too broad: with
    // no kit-type word in the title at all, there's no evidence either
    // way, so it stays conservative and leaves the number untouched -
    // exactly like a real club number would look on its own.
    expect(guessTeamFromTitle('Arsenal 96')).toBe('Arsenal 96');
  });

  it("strips a manufacturer's jacket product-line name and a youth size marker", () => {
    // Real title from a live listing: "Team: Wrexham Anthem Heritage" -
    // "Anthem Heritage" is Macron's own jacket product-line name, the
    // same family as "Presentation" above, surviving even once "Jacket"
    // itself was already being stripped.
    expect(guessTeamFromTitle('2026-27 Wrexham Macron Anthem Heritage Jacket')).toBe('Wrexham');
    // Real title from a live listing: "Team: Aberdeen Y" - "Y" (youth) is
    // this retailer's own size marker alongside the standard range, not
    // previously recognized as a size at all.
    expect(guessTeamFromTitle('1987-90 Aberdeen Umbro Home Shirt Y')).toBe('Aberdeen');
  });

  it('strips a short bare trailing letter code the same way as a short bare number, backed by the same kit-word-order evidence', () => {
    // Real title from a live listing: "Team: Atletico Madrid HJ" - same
    // mechanism as the "Sevilla 83"/"Manchester City 78" numeric cases
    // above, just with a 2-letter all-caps code instead of digits - too
    // short for the unconditional 4+ letter all-caps strip, which has no
    // other evidence to rely on and so has to stay conservative.
    expect(guessTeamFromTitle('2025-26 Atletico Madrid Nike Third Shirt *w/tags* HJ')).toBe('Atletico Madrid');
  });

  it('leaves a short bare trailing letter code alone when there is no kit-type word anywhere to prove it is a stock code', () => {
    // Guards the new short-code strip against being too broad, the same
    // way the bare-number guard above does.
    expect(guessTeamFromTitle('Arsenal HJ')).toBe('Arsenal HJ');
  });

  it('strips a trailing "<player name> #<number>" back-print when the name has a letter outside the old À-ÿ range', () => {
    // Confirmed on a real listing surviving as "Manchester United
    // Ibrahimović" - the "#"-marked strip previously only matched
    // A-Za-zÀ-ÿ, which excludes Eastern/Central European letters like "ć"
    // (Latin Extended-A, not Latin-1 Supplement), so it silently failed to
    // match the whole name and left it attached to the team guess.
    expect(guessTeamFromTitle('2016-17 Manchester United adidas Away Shirt Ibrahimović #9')).toBe(
      'Manchester United',
    );
  });

  it('strips an unmarked trailing "<player name> <number>" back-print, not just the "#"-marked form', () => {
    // Same underlying name, without a "#" marker this time - covers the
    // bare back-print shape too, not just the letter-range fix above.
    expect(guessTeamFromTitle('2016-17 Manchester United adidas Away Shirt Ibrahimović 9')).toBe(
      'Manchester United',
    );
  });

  it('does not let the unmarked player-tag strip reach across a quoted aside', () => {
    // "Trophy'" is capitalized and directly adjacent to "Home", so a
    // multi-word version of the new strip could walk backwards into the
    // quoted special-edition name and delete its closing quote, breaking
    // the later quoted-aside strip. Limited to exactly one preceding word
    // so it can't.
    expect(guessTeamFromTitle("2019 Sevilla Nike 'Antonio Puerta Trophy' Home Shirt 83")).toBe('Sevilla');
  });

  it('leaves an unmarked trailing "<word> <number>" alone when there is no kit-type word anywhere to prove it is a player tag', () => {
    // Same guard as the stock-code and letter-code cases above - without a
    // kit word anywhere in the title, this is genuinely ambiguous with a
    // real club number (Hannover 96), so it's left alone.
    expect(guessTeamFromTitle('Arsenal 96')).toBe('Arsenal 96');
  });

  it('strips a club competition name being commemorated, not just a national-team tournament', () => {
    // Real title from a live listing: "Team: Southampton FA Cup" - a "30th
    // Anniversary" shirt commemorating an FA Cup win, same bug shape as
    // the World Cup/Euros strip above but for a club competition instead
    // of a national tournament.
    expect(guessTeamFromTitle("2006 Southampton FA Cup 30th Anniversary Home Shirt")).toBe('Southampton');
  });

  it('strips "Drill" the same way as "Graphic"/"Presentation" - a training-top style word, not the team', () => {
    // Real title from a live listing: "Team: Manchester United Drill" -
    // same shape as "Wrexham Anthem Heritage" above, surviving even once
    // "Top" itself was already being stripped by the garment-word strip.
    expect(guessTeamFromTitle('1992-93 Manchester United Umbro Drill Top')).toBe('Manchester United');
  });

  it('strips "Waterproof", another training-top style word, the same way', () => {
    // Real title, found while auditing Kickio's Type enum for training-
    // shirt coverage: "1990-92 AC Milan adidas Waterproof Training Top M"
    // was surviving as "AC Milan Waterproof".
    expect(guessTeamFromTitle('1990-92 AC Milan adidas Waterproof Training Top M')).toBe('AC Milan');
  });

  it('strips "Walkout"/"Walk-Out", this retailer\'s own pre-match tunnel-wear product line', () => {
    // Real titles: "2019-20 Liverpool New Balance Walkout Jacket *w/tags*
    // XL MJ931002" was surviving as "Liverpool Walkout", and "2009 Italy
    // Puma Confederations Cup Walk-Out Pants *BNIB* XL 736053-002" (the
    // hyphenated spelling) as "Italy Walk-Out Pants" - same style-word
    // shape as "Drill"/"Waterproof" above, just spelled two ways.
    expect(guessTeamFromTitle('2019-20 Liverpool New Balance Walkout Jacket *w/tags* XL MJ931002')).toBe(
      'Liverpool',
    );
    expect(
      guessTeamFromTitle('2009 Italy Puma Confederations Cup Walk-Out Pants *BNIB* XL 736053-002'),
    ).toBe('Italy');
  });

  it('strips "Academy Pro", Nike\'s own kids\'-range product line', () => {
    // Real title: "2025 England Nike Academy Pro Pre-Match Shirt *w/tags*
    // FZ9709-407" was surviving as "England Academy Pro".
    expect(guessTeamFromTitle('2025 England Nike Academy Pro Pre-Match Shirt *w/tags* FZ9709-407')).toBe(
      'England',
    );
  });

  it('strips Nike\'s "Dri-FIT" fabric-technology branding rather than leaking half of it into the team', () => {
    // Real title: "2025-26 Barcelona Nike x Kobe Dri-FIT 1/4 Zip Training
    // Top *w/tags* IO4253-085" was surviving as "Barcelona FIT" - the
    // collab-name strip below (anchored to "x <Capitalized word>", up to
    // 3 repetitions) was greedily matching "x Kobe " and then also "Dri-"
    // as a second fake collab word (its lowercase-letter class matches
    // the hyphen, so it stopped right before the uppercase "FIT"),
    // stranding "FIT" alone. Stripping "Dri-FIT" as one atomic token
    // earlier in the chain avoids handing the collab strip anything to
    // partially eat.
    expect(
      guessTeamFromTitle('2025-26 Barcelona Nike x Kobe Dri-FIT 1/4 Zip Training Top *w/tags* IO4253-085'),
    ).toBe('Barcelona');
  });

  it('generalises the "1/4 Zip" strip to any "<digit>/<digit> Zip" shape, including a "CL " edition marker in front', () => {
    // Real title: "2007-08 AC Milan adidas CL 1/2 Zip Training Top *BNIB*
    // M 689871" was surviving as "AC Milan CL 1/2 Zip" - the old strip
    // was hardcoded to the literal "1/4 Zip" shape only, so it neither
    // matched "1/2 Zip" nor had any handling for the "CL" (Champions
    // League edition) marker directly in front of it.
    expect(
      guessTeamFromTitle('2007-08 AC Milan adidas CL 1/2 Zip Training Top *BNIB* M 689871'),
    ).toBe('AC Milan');
  });

  it('strips a quoted two-digit retro season symmetrically, including its closing quote', () => {
    // Real title: "Middlesbrough Errea '94-95' Retro Walkout Jacket
    // *w/tags* SG6Z6Z00580MDL" was surviving as "Middlesbrough '" - the
    // short two-digit-season strip's leading "'?" only ever consumed the
    // OPENING quote, never a closing one after the second digit group, so
    // the lone trailing quote was left behind as orphaned punctuation
    // once everything else around it had been correctly stripped.
    expect(
      guessTeamFromTitle("Middlesbrough Errea '94-95' Retro Walkout Jacket *w/tags* SG6Z6Z00580MDL"),
    ).toBe('Middlesbrough');
  });

  it('strips "Pants"/"Trousers"/"Bottoms"/"Tracksuit" the same way as other garment words', () => {
    // Real titles: once "Walk-Out"/"Walkout" (above) is stripped, "Italy
    // Walk-Out Pants" and "2024-25 Hull City Kappa Walkout Tracksuit
    // Bottoms *BNIB* 37216IW" were still leaking "Pants"/"Tracksuit
    // Bottoms" into the guess - these garment-type words were simply
    // missing from the same strip that already covers "Shirt"/"Jacket"/
    // "Sweatshirt"/"Hoodie".
    expect(
      guessTeamFromTitle('2009 Italy Puma Confederations Cup Walk-Out Pants *BNIB* XL 736053-002'),
    ).toBe('Italy');
    expect(
      guessTeamFromTitle('2024-25 Hull City Kappa Walkout Tracksuit Bottoms *BNIB* 37216IW'),
    ).toBe('Hull City');
  });

  it('does not read a numeric stock code\'s own internal "####-##" run as a season', () => {
    // Real title from a live listing: "Team: Italy 76" - the retailer's
    // own numeric SKU "765650-02" happens to contain a run ("5650-02")
    // shaped exactly like a season span, and an unguarded season regex
    // was matching and stripping just that middle run, leaving only the
    // leading "76" of the code behind attached to the team.
    expect(guessTeamFromTitle('2022-23 Italy Puma Away Shirt *w/tags* 765650-02')).toBe('Italy');
  });

  it('strips a trailing stock code that mixes letters, digits, and a hyphen', () => {
    // Real title from a live listing: "Team: Birmingham BM" - same
    // underlying season-regex bug as "Italy 76" above ("BM0071-459"
    // contains "0071-459", shaped like a season span), but here the
    // leftover fragment kept a couple of the code's own leading letters
    // too, so it needed a real strip for the whole hyphenated shape once
    // the season regex stopped silently absorbing most of it by accident.
    expect(guessTeamFromTitle('2025-26 Birmingham Nike Home Shirt *BNIB* BM0071-459')).toBe('Birmingham');
  });

  it('does not let the "x <collab name>" strip eat into an unrelated trailing stock code', () => {
    // Real title from a live listing: "Team: Manchester United 7536" -
    // the collab-name strip's per-word pattern previously allowed a bare
    // capital letter with nothing after it to count as a whole "word", so
    // it was greedily eating "I" and "V" off the front of the unrelated
    // trailing stock code "IV7536" as two more fake collab-name words (on
    // top of the real "George"), stranding the digits with nothing left
    // to anchor the later code strips on.
    expect(
      guessTeamFromTitle(
        '2024-25 Manchester United adidas Originals x George Best Track Pants #7 *BNIB* IV7536',
      ),
    ).toBe('Manchester United');
  });

  it('strips a size letter + hyphenated letters-then-digits stock code together', () => {
    // Real title from a live listing: "Team: Rangers M RAN-002SSA" - the
    // size+code pair strip's character class didn't allow a hyphen, so it
    // couldn't reach a code shaped like this even with a size letter
    // right in front of it to anchor on; needed the same generalized
    // hyphenated-code strip that fixed "Italy 76"/"Birmingham BM" above,
    // broadened to also cover this "letters-hyphen-alnum" shape (not just
    // "digits-hyphen-digits").
    expect(guessTeamFromTitle('2019-20 Rangers Hummel Away Shirt *w/tags* M RAN-002SSA')).toBe('Rangers');
  });

  it('does not strip "New" out of the manufacturer name "New Balance"', () => {
    // Real title from a live listing: "Team: Liverpool Balance" - the
    // condition-word strip's bare "New" alternative was matching inside
    // "New Balance" before the manufacturer loop ever got a chance to see
    // the whole phrase, leaving "Balance" behind once "New" alone had
    // already been removed from it.
    expect(guessTeamFromTitle('2017-18 Liverpool New Balance Home Shirt')).toBe('Liverpool');
  });

  it('cleans up an empty quote pair left behind once its content was already stripped', () => {
    // Real title from a live listing: "Team: Liverpool Balance ''" - the
    // quoted-aside strip required at least one character between the
    // quotes ("+"), but the digit+"Years" strip earlier in the chain had
    // already emptied out "125 Years" from inside the quotes by the time
    // this one ran, so it couldn't match (let alone remove) the now-empty
    // pair, leaving the bare quote marks behind as their own leftover
    // junk on top of the "New Balance" bug above.
    expect(
      guessTeamFromTitle("2017-18 Liverpool New Balance '125 Years' Home Shirt Lallana #20 XL"),
    ).toBe('Liverpool');
  });

  it('strips "Staff Issue" and a coat\'s own style words ("Padded"/"Rain"), not just "Coat" itself', () => {
    // Real title from a live listing: "Team: Juventus Staff Issue Padded
    // Rain Coat" - "Coat" wasn't even in the garment-word strip list at
    // all (only "Jacket" was, despite both mapping to the same
    // Jackets/Coats category), and "Staff Issue"/"Padded"/"Rain" weren't
    // recognised as style/issue-type words the way "Player Issue"/
    // "Graphic"/"Presentation" already were.
    expect(guessTeamFromTitle('1990-91 Juventus Kappa Staff Issue Padded Rain Coat *w/tags* XL')).toBe(
      'Juventus',
    );
  });

  it('strips "Terrace Icons", another manufacturer product-line name', () => {
    // Real title from a live listing: "Team: Juventus Terrace Icons" -
    // same shape as "Anthem Heritage"/"Originals" above.
    expect(guessTeamFromTitle('2024-25 Juventus adidas Terrace Icons Hoodie *w/tags* M')).toBe('Juventus');
  });

  it('strips a longer hyphenated stock code than the first version of this strip allowed for', () => {
    // Real title from a live listing: "Team: Juventus 95000JV-000" - 7
    // characters ahead of the hyphen, longer than the "Italy 76"/
    // "Birmingham BM" fix's original 1-6 character cap allowed.
    expect(guessTeamFromTitle('1994-95 Juventus Kappa Basic Home Shirt *BNIB* 95000JV-000')).toBe(
      'Juventus',
    );
  });

  it('does not read ordinary kit/noise words right before a marked number as if they were a player name', () => {
    // Real title from a live listing: "Team: Athletic Bilbao Match" - a
    // blank/number-only match-issue shirt with no real player name at
    // all. Without a noise-word exclusion on this strip's own word-slots
    // (mirroring PLAYER_NAME_NOISE_WORDS below, for the same reason),
    // "Issue Home Shirt" - three ordinary, unrelated capitalized words,
    // not a name - was being read as if it were the player name right
    // before "#5" and stripped along with it, taking "Issue" with it
    // before the "Match Issue" phrase strip ever got a chance to see it
    // as a whole phrase.
    expect(guessTeamFromTitle('1992-94 Athletic Bilbao Match Issue Home Shirt #5')).toBe('Athletic Bilbao');
  });

  it('strips "x <manufacturer>" even when the manufacturer is written lowercase', () => {
    // Real title from a live listing: "Team: Manchester United x
    // Ultimate365 Tour WIND.RDY" - the "x <collab name>" strip requires a
    // genuinely capitalized word after "x" by design (so it can't mistake
    // ordinary lowercase text for a collab name), which correctly leaves
    // "x adidas" (lowercase) alone rather than risk that - but then
    // nothing else removed the bare "x" once the MANUFACTURERS loop
    // separately (and correctly) stripped "adidas" on its own.
    expect(
      guessTeamFromTitle('2025-26 Manchester United x adidas Ultimate365 Tour WIND.RDY Hoodie'),
    ).toBe('Manchester United');
  });

  it('strips "TFG", a manufacturer this retailer\'s own vendor list has but this codebase\'s MANUFACTURERS list was missing', () => {
    // Real title: "2002-03 Wrexham TFG Match Issue Third Shirt" was
    // surviving as "Wrexham TFG" - confirmed via
    // vintagefootballshirts.com/collections/vendors?q=TFG that TFG is one
    // of this retailer's own vendor/manufacturer facets, not a stray word.
    expect(guessTeamFromTitle('2002-03 Wrexham TFG Match Issue Third Shirt')).toBe('Wrexham');
  });

  it('strips "Limited Edition" the same way as "Centenary"/"Anniversary"/"Jubilee"', () => {
    // Real title: "2013 Madureira Limited Edition 'Che Guevara 50 Years'
    // GK Shirt" was surviving as "Madureira Limited Edition" once the
    // quoted aside itself was already being stripped correctly.
    expect(
      guessTeamFromTitle("2013 Madureira Limited Edition 'Che Guevara 50 Years' GK Shirt"),
    ).toBe('Madureira');
  });

  it('widens the hyphenated stock-code strip to a 9+ character prefix', () => {
    // Real title: "2025-26 West Ham Umbro Away Shirt L/S *w/tags* XXXL
    // TM12552NS-030" was surviving as "West Ham TM12552NS-030" - the
    // 9-character prefix "TM12552NS" exceeded the strip's original 8-
    // character limit.
    expect(
      guessTeamFromTitle('2025-26 West Ham Umbro Away Shirt L/S *w/tags* XXXL TM12552NS-030'),
    ).toBe('West Ham');
  });
});

describe('matchKickioTeam', () => {
  const teams = [
    { name: 'Arsenal', slug: 'arsenal' },
    { name: 'Real Madrid', slug: 'real-madrid' },
    { name: 'Saint-Étienne', slug: 'saint-etienne' },
    { name: 'Manchester United', slug: 'manchester-united' },
  ];

  it('matches exactly, case-insensitively', () => {
    expect(matchKickioTeam('arsenal', teams)).toEqual({ name: 'Arsenal', slug: 'arsenal', matchType: 'exact' });
  });

  it('matches after normalizing accents/punctuation when there is no exact match', () => {
    // "Saint Etienne" (no accent, no hyphen) doesn't exactly equal Kickio's
    // "Saint-Étienne", but normalizes to the same thing.
    expect(matchKickioTeam('Saint Etienne', teams)).toEqual({
      name: 'Saint-Étienne',
      slug: 'saint-etienne',
      matchType: 'normalized',
    });
  });

  it('matches after stripping a club-designator word', () => {
    expect(matchKickioTeam('Real Madrid CF', teams)).toEqual({
      name: 'Real Madrid',
      slug: 'real-madrid',
      matchType: 'normalized',
    });
  });

  it('returns null for a genuinely unmatched guess, rather than guessing at the closest one', () => {
    // Deliberately no fuzzy/trigram fallback here - "Man Utd" is a real
    // alias Kickio's own team_aliases table would resolve, but this
    // function can't see that table (authenticated-only), so it's left
    // unmatched rather than guessed at.
    expect(matchKickioTeam('Man Utd', teams)).toBeNull();
    expect(matchKickioTeam('Totally Unknown FC', teams)).toBeNull();
  });

  it('returns null for a blank guess', () => {
    expect(matchKickioTeam('', teams)).toBeNull();
    expect(matchKickioTeam('   ', teams)).toBeNull();
  });

  describe('containment fallback', () => {
    it('matches a short form that is unambiguously contained in exactly one canonical name', () => {
      // Confirmed directly against Kickio's live team list: "Leeds" and
      // "Blackburn" each match exactly one real team there ("Leeds
      // United", "Blackburn Rovers") - no other team name contains
      // either word, so this is safe to accept without a gender
      // tiebreaker or any other extra evidence.
      const leedsTeams = [{ name: 'Leeds United', slug: 'leeds-united' }, { name: 'Arsenal', slug: 'arsenal' }];
      expect(matchKickioTeam('Leeds', leedsTeams)).toEqual({
        name: 'Leeds United',
        slug: 'leeds-united',
        matchType: 'contained',
      });

      const blackburnTeams = [{ name: 'Blackburn Rovers', slug: 'blackburn-rovers' }];
      expect(matchKickioTeam('Blackburn', blackburnTeams)).toEqual({
        name: 'Blackburn Rovers',
        slug: 'blackburn-rovers',
        matchType: 'contained',
      });
    });

    it('breaks a tie between a men\'s and women\'s team of the same name using the profile\'s own gender', () => {
      // Confirmed directly against Kickio's live team list: "Tottenham"
      // alone matches BOTH "Tottenham Hotspur" and "Tottenham Hotspur
      // Women" there - genuinely ambiguous by containment alone, so the
      // already-resolved gender field is used to pick between them
      // rather than guessing.
      const spursTeams = [
        { name: 'Tottenham Hotspur', slug: 'tottenham-hotspur' },
        { name: 'Tottenham Hotspur Women', slug: 'tottenham-hotspur-women' },
      ];
      expect(matchKickioTeam('Tottenham', spursTeams, 'Mens')).toEqual({
        name: 'Tottenham Hotspur',
        slug: 'tottenham-hotspur',
        matchType: 'contained',
      });
      expect(matchKickioTeam('Tottenham', spursTeams, 'Womens')).toEqual({
        name: 'Tottenham Hotspur Women',
        slug: 'tottenham-hotspur-women',
        matchType: 'contained',
      });
    });

    it('resolves "Rangers" via normalized equality, not containment, despite 9+ real teams sharing the word', () => {
      // Confirmed directly against Kickio's live team list: "Rangers"
      // alone is a SUBSTRING of 9+ real, unrelated teams there (Carrick
      // Rangers, Queens Park Rangers, Rangers FC (HK), Rangers du Congo,
      // ...), which would make blind containment matching genuinely
      // ambiguous - but "Rangers FC" is the only one of them whose name
      // normalizes down to exactly "rangers" (stripping "FC" as a bare
      // club-designator suffix; none of the others have just a
      // designator word and nothing else), so the existing normalized-
      // equality step above already resolves this correctly on its own,
      // before containment ever needs to run.
      const rangersTeams = [
        { name: 'Rangers FC', slug: 'rangers-fc' },
        { name: 'Queens Park Rangers', slug: 'queens-park-rangers' },
        { name: 'Carrick Rangers', slug: 'carrick-rangers' },
        { name: 'Rangers du Congo', slug: 'rangers-du-congo' },
      ];
      expect(matchKickioTeam('Rangers', rangersTeams, 'Mens')).toEqual({
        name: 'Rangers FC',
        slug: 'rangers-fc',
        matchType: 'normalized',
      });
    });

    it('stays unmatched when a short form is genuinely ambiguous by containment, even with a gender hint', () => {
      // Unlike "Rangers" above, none of these normalize down to bare
      // "real" (each keeps its own distinguishing second word), so this
      // reaches the containment step - where it's genuinely ambiguous
      // among three real, unrelated clubs, and none of them differ by
      // "Women" either, so the gender tiebreaker can't help. Guessing
      // among them would risk a confidently-wrong match, worse than
      // staying unmatched.
      const realTeams = [
        { name: 'Real Madrid', slug: 'real-madrid' },
        { name: 'Real Sociedad', slug: 'real-sociedad' },
        { name: 'Real Betis', slug: 'real-betis' },
      ];
      expect(matchKickioTeam('Real', realTeams, 'Mens')).toBeNull();
    });

    it('does not match a canonical name shorter than the containment length floor', () => {
      // Same length guard match_team_smart's own containment step uses -
      // a very short canonical name is too easy to coincidentally contain
      // (or be contained by) an unrelated guess.
      const shortNameTeams = [{ name: 'PSV', slug: 'psv' }];
      expect(matchKickioTeam('PSV Eindhoven', shortNameTeams)).toBeNull();
    });
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

  it('strips "Track"/"Pants" the same way as "Shirt"/"Top", not just as part of the surname', () => {
    // Real title from a live listing: player name was surviving as "Best
    // Track Pants" instead of just "Best" on this training-wear tribute
    // item, since "Track"/"Pants" weren't in the noise-word list yet.
    expect(
      extractPlayerNameFromTitle(
        '2024-25 Manchester United adidas Originals x George Best Track Pants #7 *BNIB* IV7536',
      ),
    ).toBe('Best');
  });

  it('does not read "Goalkeeper"/"GK" or a colour word right before a shirt number as if it were a player name', () => {
    // Real titles, found while auditing every real Type value against
    // live listings: "1988-90 England Goalkeeper Shirt #1 M" was
    // surviving as player "Goalkeeper", and "2000-01 Everton Goalkeeper
    // Shirt White #1 M" as "Goalkeeper White" (then, once "Goalkeeper"
    // alone was excluded, as bare "White") - neither title has a real
    // back-printed surname anywhere in it: "#1" is this retailer's own
    // convention for an unqualified goalkeeper shirt's number, and
    // "White" describes the shirt's colour, not a person. This function
    // has no team context of its own: for the 3-word England title, what
    // survives once "Goalkeeper"/"Shirt" are excluded is the bare team
    // name itself ("England"), within the tail match's own 3-word cap -
    // buildKickioProfile (tested separately below) is what reduces that
    // further to null, via normalizePlayerName's own team-context
    // stripping. The 4-word Everton title falls outside that same 3-word
    // cap once "Everton" is counted, so "Goalkeeper Shirt White" is all
    // that's captured, and excluding all three of those noise words
    // empties the candidate straight to null here already.
    expect(extractPlayerNameFromTitle('1988-90 England Goalkeeper Shirt #1 M')).toBe('England');
    expect(extractPlayerNameFromTitle('2000-01 Everton Goalkeeper Shirt White #1 M')).toBeNull();
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
  });

  it('maps a youth/kids size to Kickio\'s age-band format, not a letter size', () => {
    // Confirmed directly by Kickio: youth sizing is age-band only ("we
    // only work in years (age)") - this used to return "Youth L" etc,
    // a format Kickio's size field doesn't actually accept at all.
    expect(extractSizeFromTitle('Youth L')).toBe('11-12 Years');
    expect(extractSizeFromTitle('Boys Medium')).toBe('9-10 Years');
    expect(extractSizeFromTitle('Junior XL')).toBe('13-14 Years');
    expect(extractSizeFromTitle('Kids S')).toBe('7-8 Years');
    expect(extractSizeFromTitle('Youth XS')).toBe('5-6 Years');
    expect(extractSizeFromTitle('Youth XXL')).toBe('15-16 Years');
  });

  it('uses "3XL" for the triple-large adult size, not "XXXL"', () => {
    // Confirmed directly by Kickio: the canonical allowed-values list
    // (6XL, 5XL, 4XL, 3XL, XXL, XL, L, M, S, XS) is the correct one - the
    // guide's own "Recognised source notations" table disagreed with its
    // own allowed-values list on this exact point before this was checked.
    expect(extractSizeFromTitle('Size XXXL')).toBe('3XL');
    expect(extractSizeFromTitle('Size 3XL')).toBe('3XL');
    expect(extractSizeFromTitle('(XXXL)')).toBe('3XL');
    expect(extractSizeFromTitle('XXXL')).toBe('3XL');
  });

  it('extends adult sizing up to 6XL', () => {
    expect(extractSizeFromTitle('Size 4XL')).toBe('4XL');
    expect(extractSizeFromTitle('Size 5XL')).toBe('5XL');
    expect(extractSizeFromTitle('Size 6XL')).toBe('6XL');
  });

  it('maps a bare "XXS" to the 9-10 Years age band - Kickio has no adult XXS at all', () => {
    // Confirmed directly by Kickio: "if its an adult XXS it's 9-10 yrs
    // (kids)" - a listing using "XXS" as if it were an adult size is
    // really describing a 9-10 year old's fit, not a smaller adult cut.
    expect(extractSizeFromTitle('Size XXS')).toBe('9-10 Years');
    expect(extractSizeFromTitle('(XXS)')).toBe('9-10 Years');
    expect(extractSizeFromTitle('XXS')).toBe('9-10 Years');
  });
});

describe('extractSizeFromVariant', () => {
  it('normalises a Shopify-style variant segment the same way as the title parser', () => {
    expect(extractSizeFromVariant('L / Red')).toBe('L');
    expect(extractSizeFromVariant('XXXL / Blue')).toBe('3XL');
    expect(extractSizeFromVariant('XXS / Red')).toBe('9-10 Years');
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

  it("maps onto Kickio's full 6-tier ladder, including the Fair tier", () => {
    // Confirmed against kickio-shirt-mapping-guide.md (Kickio's own
    // canonical spec, Part 2): the ladder has six tiers, not five - "fair"/
    // "acceptable"/Vinted's "Satisfactory"-equivalent labels/a 4-5/10
    // rating all map to Fair, distinctly harsher than Good but distinctly
    // better than Needs Attention (which is reserved for "well used",
    // "worn", "poor condition", etc.). This function used to collapse all
    // of these into Needs Attention, a harsher grade than any of them
    // actually mean.
    expect(gradeConditionText('Fair condition, some wear')).toBe('Fair');
    expect(gradeConditionText('Acceptable condition')).toBe('Fair');
    expect(gradeConditionText('Satisfactory')).toBe('Fair');
    expect(gradeConditionText('5/10 condition')).toBe('Fair');
    expect(gradeConditionText('4/10 condition')).toBe('Fair');
    expect(gradeConditionText('3/10 condition')).toBe('Needs Attention');
    expect(gradeConditionText('Well used, some fading')).toBe('Needs Attention');
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

  it('sets team_kickio_match when a live Kickio team list is supplied and the resolved team matches', () => {
    const kickioTeams = [{ name: 'Manchester United', slug: 'manchester-united' }];

    const matched = buildKickioProfile({
      url: 'https://www.ebay.co.uk/itm/1',
      title: 'Manchester United 2012-13 Away Shirt',
      extracted: { team: 'Manchester United' },
      kickioTeams,
    });
    expect(matched.identity.team).toBe('Manchester United');
    expect(matched.identity.team_kickio_match).toBe('Manchester United');

    const unmatched = buildKickioProfile({
      url: 'https://www.ebay.co.uk/itm/2',
      title: 'Some Obscure Non-League Club 2012-13 Away Shirt',
      extracted: { team: 'Some Obscure Non-League Club' },
      kickioTeams,
    });
    expect(unmatched.identity.team_kickio_match).toBeNull();
  });

  it('leaves team_kickio_match null when no Kickio team list was supplied at all', () => {
    // Same as before this feature existed - a deployment without
    // KICKIO_SUPABASE_URL configured shouldn't flag every item as
    // unmatched just because matching was never attempted.
    const profile = buildKickioProfile({
      url: 'https://www.ebay.co.uk/itm/1',
      title: 'Manchester United 2012-13 Away Shirt',
      extracted: { team: 'Manchester United' },
    });
    expect(profile.identity.team_kickio_match).toBeNull();
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

  it('infers Jackets/Coats and Hoodies/Sweat Tops categories from the title when no explicit category field is configured', () => {
    // Real titles from live listings: these were previously always
    // defaulting to "Football Shirts" with no category field configured on
    // the site, even though the title itself plainly says otherwise -
    // confirmed by "Wrexham Macron Anthem Heritage Jacket" and "Manchester
    // United adidas Essentials 1/4 Zip Sweatshirt" surviving with a bare
    // team name once the garment-type words were correctly stripped from
    // it, meaning the category signal was there in the title all along.
    const jacket = buildKickioProfile({
      url: 'https://www.vintagefootballshirts.com/products/wrexham-anthem-heritage-jacket',
      title: '2026-27 Wrexham Macron Anthem Heritage Jacket',
    });
    expect(jacket.category).toBe('Jackets/Coats');
    expect(jacket.identity.shirt_type).toBeNull();

    const sweatshirt = buildKickioProfile({
      url: 'https://www.vintagefootballshirts.com/products/man-utd-essentials-sweatshirt',
      title: '2024-25 Manchester United adidas Essentials 1/4 Zip Sweatshirt',
    });
    expect(sweatshirt.category).toBe('Hoodies/Sweat Tops');
  });

  it('leaves category as Football Shirts for an ordinary shirt title', () => {
    const profile = buildKickioProfile({
      url: 'https://www.vintagefootballshirts.com/products/arsenal-home-shirt',
      title: '2020-21 Arsenal Adidas Home Shirt',
    });
    expect(profile.category).toBe('Football Shirts');
  });

  it('infers the Shorts category from the title too', () => {
    // Confirmed the same gap existed for Shorts as for Jackets/Hoodies:
    // "Arsenal Adidas Home Shorts" was defaulting to Football Shirts and
    // also picking up shirt_type "Home" as if it were an actual shirt
    // title, since nothing distinguished a shorts listing from a shirt
    // one. shirt_type is now also left null here, same as for a jacket -
    // queried Kickio's own live feature_category_links table directly and
    // confirmed the "type" product_feature is linked ONLY to the Football
    // Shirts category (Kickio's real Shorts category only carries
    // manufacturer/colour/signed - no type, no size, no season, nothing
    // else), so a guessed "Home"/"Away"/"Third" would never even have
    // anywhere to go on a real Shorts listing there.
    const shorts = buildKickioProfile({
      url: 'https://www.vintagefootballshirts.com/products/arsenal-home-shorts',
      title: '2024-25 Arsenal Adidas Home Shorts',
    });
    expect(shorts.category).toBe('Shorts');
    expect(shorts.identity.shirt_type).toBeNull();

    // Guards the new match against "Short-Sleeved"/"Short Sleeve" -
    // singular "Short", not "Shorts" - being mistaken for a shorts
    // listing.
    const shortSleeved = buildKickioProfile({
      url: 'https://www.vintagefootballshirts.com/products/arsenal-short-sleeved-shirt',
      title: '2024-25 Arsenal Adidas Home Short-Sleeved Shirt',
    });
    expect(shortSleeved.category).toBe('Football Shirts');
  });

  it('infers Socks, Scarves, Boots and Other (tracksuit bottoms/pants) categories too, all with shirt_type left null', () => {
    // Same gap as Jackets/Hoodies/Shorts above, for the rest of Kickio's
    // real, live category list (queried directly from its `categories`
    // table - this codebase's own LIVE_CATEGORIES constant matches it
    // exactly) that detectCategoryFromTitle simply had no branch for yet.
    // Real titles: "2016-17 Crystal Palace Macron Away Socks", "PSV
    // 'Martin Glas' Scarf", "adidas X Speedportal.1 FG Football Boots
    // *BNIB* GW84428", "2024-25 Hull City Kappa Walkout Tracksuit Bottoms
    // *BNIB* 37216IW". Also confirmed directly against Kickio's own live
    // feature_category_links table that the "type" product_feature is
    // linked ONLY to the Football Shirts category - none of these has
    // anywhere for a guessed Home/Away/Third to go, so shirt_type must
    // stay null for every one of them, not just for a jacket.
    const socks = buildKickioProfile({
      url: 'https://www.vintagefootballshirts.com/products/x',
      title: '2016-17 Crystal Palace Macron Away Socks',
    });
    expect(socks.category).toBe('Socks');
    expect(socks.identity.shirt_type).toBeNull();

    const scarf = buildKickioProfile({
      url: 'https://www.vintagefootballshirts.com/products/x',
      title: "PSV 'Martin Glas' Scarf",
    });
    expect(scarf.category).toBe('Scarves');
    expect(scarf.identity.shirt_type).toBeNull();

    const boots = buildKickioProfile({
      url: 'https://www.vintagefootballshirts.com/products/x',
      title: 'adidas X Speedportal.1 FG Football Boots *BNIB* GW84428',
    });
    expect(boots.category).toBe('Boots');
    expect(boots.identity.shirt_type).toBeNull();

    const bottoms = buildKickioProfile({
      url: 'https://www.vintagefootballshirts.com/products/x',
      title: '2024-25 Hull City Kappa Walkout Tracksuit Bottoms *BNIB* 37216IW',
    });
    expect(bottoms.category).toBe('Other');
    expect(bottoms.identity.shirt_type).toBeNull();
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
