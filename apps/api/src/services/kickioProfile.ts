/**
 * Maps a raw scraped listing (title, description, price, images, and any
 * site-configured extracted fields) onto Kickio's football-shirt product
 * schema, following the rules in "Shirt Feature Mapping Guide for a
 * Third-Party Scraper" (kickio-shirt-mapping-guide.md). This never talks to
 * Kickio's database - it only derives a read-only "product profile" for the
 * admin UI to review, in the exact JSON shape documented in Part 4 of that
 * guide.
 *
 * "Never invent a value": every canonicalizer below falls back to null/the
 * documented default rather than guessing, and anything left uncertain is
 * surfaced via `confidence` / `needs_review` / `review_reason` instead of
 * being silently resolved.
 */

export type Confidence = 'certain' | 'inferred';

export interface KickioIdentity {
  team: string | null;
  /**
   * The Kickio `teams` row `team` matched against (exact, normalized, or
   * unambiguous-containment match - see matchKickioTeam()), when a live
   * list was available - see KickioProfileInput.kickioTeams. Purely a
   * corroboration signal for the admin UI; `team` above is always left as
   * the raw scraped/guessed text, never overwritten by this.
   *
   * Decided policy for the future write-integration (not yet built - see
   * kickio-shirt-mapping-guide.md/session history): a listing should only
   * ever be sent to Kickio using THIS field, never the raw `team` above.
   * When this is null (no confident match), the listing should be held
   * for human review rather than sent with a guessed team name - sending
   * `team` as-is risks either failing Kickio's own matching outright or,
   * worse, creating a garbage team entry there.
   */
  team_kickio_match: string | null;
  season: string | null;
  extra_seasons: string[];
  shirt_type: string | null;
  gender: string;
  issue: string | null;
  special_edition: string | null;
  sleeves: string | null;
  signed: string | null;
  player: string | null;
  number: string | null;
}

export interface KickioListing {
  condition: string | null;
  size: string | null;
  manufacturer: string | null;
  colour: string | null;
  colour_secondary: string | null;
  boxed_edition: string | null;
  /** Always GBP-denominated - Kickio's own marketplace currency, converted from whatever the source site reported. */
  price: number | null;
  currency: string | null;
  /**
   * The listing's price/currency exactly as the source site reported it,
   * before GBP conversion - kept for transparency, since the conversion
   * uses an admin-maintained approximate rate, not a live/exact one. Both
   * null when the site's own price was already GBP (nothing to convert).
   */
  original_price: number | null;
  original_currency: string | null;
  /** The rate_to_gbp actually applied, or null if no conversion happened. */
  fx_rate_used: number | null;
  quantity: number | null;
  images: string[];
  /**
   * Availability signal detected from the listing text ("Out of stock",
   * "sold out", a quantity of 0, etc). Not part of the documented Kickio
   * field set in the mapping guide (which covers product identity, not
   * listing lifecycle) - this is Kickcrawl's own read of the page.
   * 'Unknown' means there was page text to check but neither an in-stock
   * nor an out-of-stock signal was found in it - kept distinct from `null`
   * (nothing was scraped for this item at all) so it stays filterable
   * instead of silently vanishing from both filter options.
   */
  stock_status: 'In Stock' | 'Out of Stock' | 'Unknown' | null;
}

export interface KickioProfile {
  source: {
    marketplace: string | null;
    url: string;
    scraped_at: string;
  };
  category: string;
  identity: KickioIdentity;
  listing: KickioListing;
  custom_attributes: Record<string, string>;
  confidence: Record<string, Confidence>;
  needs_review: boolean;
  review_reason: string | null;
}

export interface KickioProfileInput {
  url: string;
  marketplace?: string | null;
  scrapedAt?: string;
  title?: string | null;
  description?: string | null;
  images?: (string | null | undefined)[] | null;
  price?: number | null;
  currency?: string | null;
  quantity?: number | null;
  /** Arbitrary site-configured selector/LLM fields, checked by common alias names. */
  extracted?: Record<string, string> | null;
  /**
   * Admin-maintained ISO currency code -> GBP conversion rate (1 unit of
   * that currency = this many GBP), from the currency_rates table. A
   * non-GBP price is converted using this when a rate for its currency is
   * configured; left as-scraped (currency untouched) otherwise, since
   * guessing a rate would violate this file's "never invent a value" rule.
   */
  currencyRates?: Record<string, number> | null;
  /**
   * Kickio's live canonical team list (from KICKIO_SUPABASE_URL - see
   * lib/kickioTeams.ts), for matchKickioTeam() to check the resolved team
   * string against. Omitted/null when that isn't configured in this
   * deployment - team_kickio_match is then always null too, same as before
   * this existed.
   */
  kickioTeams?: readonly KickioTeamRef[] | null;
}

// =========================================================================
// Fixed vocabularies (Part 2 of the guide - taken verbatim from Kickio's
// SHIRT_OPTIONS / options.ts, not re-derived or guessed).
// =========================================================================

const LIVE_CATEGORIES = [
  'Football Shirts',
  'Shorts',
  'Socks',
  'Jackets/Coats',
  'Hoodies/Sweat Tops',
  'Boots',
  'Scarves',
  'Memorabilia',
  'Other',
];

const MANUFACTURERS = [
  'ABM', 'Adidas', 'Admiral', 'Airness', 'Asics', 'Atletica', 'Avec', 'Bukta', 'Canterbury',
  'Capelli Sport', 'Castore', 'Champion', 'Charly', 'Corona Sport', 'Craft', 'Cruyff',
  'Diadora', 'Ellesse', 'Erima', 'Errea', 'Fila', 'Garcis', 'Givova', 'Hi-Tec', 'Hummel',
  'Hungaria', 'Inaria', 'Jako', 'Joma', 'Jordan', 'Kappa', 'Kelme', 'Kipsta', 'Kooga', 'Kronos',
  'Le Coq Sportif', 'Legea', 'Lotto', 'Luanvi', 'Macron', 'Marathon', 'Masita', 'Meyba',
  'Mitre', 'Mizuno', 'New Balance', 'NR', 'Nike', 'Olympikus', 'Patrick', 'Penalty', 'Pony',
  'Puma', 'Reebok', 'Reusch', 'Robey', 'Saller', 'Score Draw', 'Sergio Tacchini', 'Sondico',
  'Soka', 'Stanno', 'TFG', 'Toffs', 'Topper', 'Uhlsport', 'Umbro', 'Under Armour', 'Vandanel',
  'Warrior', 'Wilson',
];

// Broader raw-text detection list (includes shades not in the fixed palette,
// e.g. "Teal"/"Beige" - detected here but dropped to null by COLOUR_MAP
// below, per the guide's "leave blank if unmapped" rule). Ordered so
// multi-word/more specific phrases are tried before their bare form.
const COLOUR_WORDS = [
  'Sky Blue', 'Light Blue', 'Royal Blue', 'Navy', 'Dark Blue', 'Dark Green', 'Light Green',
  'Burgundy', 'Maroon', 'Blue', 'Black', 'White', 'Red', 'Yellow', 'Green', 'Orange', 'Purple',
  'Pink', 'Grey', 'Gold', 'Claret', 'Brown', 'Cream', 'Silver', 'Teal', 'Beige', 'Coral',
  'Turquoise', 'Multi',
];

const COLOUR_MAP: Record<string, string> = {
  'sky blue': 'Blue (Sky)',
  'light blue': 'Blue (Sky)',
  navy: 'Blue (Navy)',
  'dark blue': 'Blue (Navy)',
  'royal blue': 'Blue (Navy)',
  blue: 'Blue',
  'dark green': 'Green',
  'light green': 'Green',
  green: 'Green',
  burgundy: 'Maroon',
  maroon: 'Maroon',
  black: 'Black',
  white: 'White',
  red: 'Red',
  yellow: 'Yellow',
  orange: 'Orange',
  purple: 'Purple',
  pink: 'Pink',
  grey: 'Grey',
  gold: 'Gold',
  claret: 'Claret',
  brown: 'Brown',
  cream: 'Cream',
};

const TOURNAMENT_KEYWORDS =
  /\b(world cup|fifa|olympic|olympics|euro\s*\d{0,4}|euros|copa\s+america|africa cup|afcon|nations league|confederations cup)\b/i;

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function caseInsensitiveGet(extracted: Record<string, string> | null | undefined, ...aliases: string[]): string | null {
  if (!extracted) return null;
  const lowerMap = new Map(Object.entries(extracted).map(([k, v]) => [k.toLowerCase().replace(/[\s_-]+/g, ''), v]));
  for (const alias of aliases) {
    const v = lowerMap.get(alias.toLowerCase().replace(/[\s_-]+/g, ''));
    if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
  }
  return null;
}

// =========================================================================
// Season (Part 2 "Season released" - parsing rules 1-8)
// =========================================================================

export interface SeasonResult {
  season: string;
  extraSeasons: string[];
}

/** "24/25" -> "2024-25", "95-96" -> "1995-96". Only consecutive 2-digit pairs. */
export function expandShortSeason(raw: string): string | null {
  const m = String(raw).trim().match(/^'?(\d{2})\s*[/-]\s*'?(\d{2})$/);
  if (!m) return null;
  const a = parseInt(m[1], 10);
  const b = parseInt(m[2], 10);
  if ((a + 1) % 100 !== b) return null;
  const cutoff = (new Date().getUTCFullYear() % 100) + 1;
  const start = a <= cutoff ? 2000 + a : 1900 + a;
  return `${start}-${String(b).padStart(2, '0')}`;
}

export function normalizeSeason(raw: string): SeasonResult {
  const short = expandShortSeason(raw);
  if (short) raw = short;
  let startYear: number;
  let endYear: number;
  if (/^\d{4}-\d{2}$/.test(raw)) {
    startYear = parseInt(raw.slice(0, 4), 10);
    const endPart = parseInt(raw.slice(5), 10);
    const century = Math.floor(startYear / 100) * 100;
    endYear = endPart < parseInt(raw.slice(2, 4), 10) ? century + 100 + endPart : century + endPart;
  } else {
    const rangeMatch = raw.match(/^(\d{4})[/-](\d{2,4})$/);
    if (rangeMatch) {
      startYear = parseInt(rangeMatch[1], 10);
      const endPartStr = rangeMatch[2];
      if (endPartStr.length <= 2) {
        const century = Math.floor(startYear / 100) * 100;
        const ep = parseInt(endPartStr, 10);
        const sp = startYear % 100;
        endYear = ep < sp ? century + 100 + ep : century + ep;
      } else {
        endYear = parseInt(endPartStr, 10);
      }
    } else if (/^\d{4}$/.test(raw)) {
      startYear = parseInt(raw, 10);
      endYear = startYear + 1;
    } else {
      return { season: '', extraSeasons: [] };
    }
  }
  if (startYear < 1900 || startYear > 2099) return { season: '', extraSeasons: [] };
  const baseSeason = `${startYear}-${String(startYear + 1).slice(2)}`;
  const extras: string[] = [];
  for (let y = startYear + 1; y < endYear; y++) extras.push(`${y}-${String(y + 1).slice(2)}`);
  return { season: baseSeason, extraSeasons: extras };
}

function shortSeasonsIn(text: string): string[] {
  const re = /(?<![\d/-])'?(\d{2})\s*[/-]\s*'?(\d{2})(?![\d/-])/g;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const expanded = expandShortSeason(`${m[1]}/${m[2]}`);
    if (!expanded) continue;
    const norm = normalizeSeason(expanded).season;
    if (norm) out.add(norm);
  }
  return [...out];
}

/**
 * Single-season extraction (rules 1-6, 8). Deliberately bails to blank on
 * anything ambiguous - two distinct ranges, two distinct shorthand pairs, a
 * bare year next to a tournament keyword, or an unparseable shape.
 */
export function extractSeason(text: string): SeasonResult {
  const rangeRe = /(\d{4})[-/](\d{2,4})/g;
  // Keyed by the normalized base season, so two mentions of the exact same
  // range (or the same range written two ways) don't count as ambiguous -
  // but critically this keeps the FULL result (extraSeasons included) from
  // each match, rather than re-normalizing just the season string alone
  // afterwards, which would silently drop a genuine span like "1998-00"
  // (season 1998-99 + extra 1999-00) back down to a single season.
  const rangeMatches = new Map<string, SeasonResult>();
  let m: RegExpExecArray | null;
  while ((m = rangeRe.exec(text)) !== null) {
    const r = normalizeSeason(`${m[1]}-${m[2]}`);
    if (!r.season) continue;
    const existing = rangeMatches.get(r.season);
    if (!existing || r.extraSeasons.length > existing.extraSeasons.length) {
      rangeMatches.set(r.season, r);
    }
  }
  if (rangeMatches.size > 1) return { season: '', extraSeasons: [] };
  if (rangeMatches.size === 1) return [...rangeMatches.values()][0];

  const shorts = shortSeasonsIn(text);
  if (shorts.length === 1) return normalizeSeason(shorts[0]);
  if (shorts.length > 1) return { season: '', extraSeasons: [] };

  // Rule 6: two bare years, no explicit range (eBay pattern) - expand to the range.
  const yearRe = /\b(?:19|20)\d{2}\b/g;
  const years = new Set<string>();
  while ((m = yearRe.exec(text)) !== null) years.add(m[0]);
  if (years.size === 2 && !TOURNAMENT_KEYWORDS.test(text)) {
    const nums = [...years].map((y) => parseInt(y, 10)).sort((a, b) => a - b);
    const [start, end] = nums;
    if (end > start && end - start <= 30) return normalizeSeason(`${start}-${end}`);
  }
  if (years.size !== 1) return { season: '', extraSeasons: [] };
  if (TOURNAMENT_KEYWORDS.test(text)) return { season: '', extraSeasons: [] };
  return normalizeSeason([...years][0]);
}

/** Rule 7: chained/multi-year spans collapse to one covering span (capped at 12 years). */
export function extractSeasonSpan(text: string): SeasonResult {
  const chain = text.match(/\b((?:19|20)\d{2})((?:\s*[/-]\s*\d{2,4}){2,})/);
  if (chain) {
    const parts = chain[2].split(/[/-]/).map((p) => p.trim()).filter(Boolean);
    const lastRaw = parts[parts.length - 1];
    const chained = normalizeSeason(`${chain[1]}-${lastRaw}`);
    if (chained.season) return chained;
  }
  const rangeRe = /(\d{4})[-/](\d{2,4})/g;
  const bounds: Array<[number, number]> = [];
  let m: RegExpExecArray | null;
  while ((m = rangeRe.exec(text)) !== null) {
    const r = normalizeSeason(`${m[1]}-${m[2]}`);
    if (!r.season) continue;
    const start = parseInt(r.season.slice(0, 4), 10);
    const last = r.extraSeasons.length ? r.extraSeasons[r.extraSeasons.length - 1] : r.season;
    bounds.push([start, parseInt(last.slice(0, 4), 10) + 1]);
  }
  if (bounds.length > 1) {
    const start = Math.min(...bounds.map((b) => b[0]));
    const end = Math.max(...bounds.map((b) => b[1]));
    if (end > start && end - start <= 12) return normalizeSeason(`${start}-${end}`);
  }
  return extractSeason(text);
}

// =========================================================================
// Shirt type (Part 2 "Type" - Goalkeeper checked first, then Training/
// Pre-Match, then Fourth/Third/Away/Home)
//
// Kickio's live "type" product_feature carries 10 variants, not the 8
// this file originally mapped to - confirmed directly against the admin
// UI's own Variants list (Home, Away, Third, Fourth, GK Home, GK Away, GK
// Third, GK Fourth, Pre-Match, Training) and re-verified against the live
// product_features row itself, which no longer matches the
// 20260522030000_align_features_to_kickio.sql seed migration's 8-value
// list this file was previously built from: Kickio has since added
// "Pre-Match" and "Training" as real, flat Type values (not GK-qualified
// - there's no "GK Training"), so they're no longer left null/
// informational the way they were before.
// =========================================================================

const HOME_TOKEN = /\b(home|1st|primera|casa|domicile|heim|hemma)\b/;
const AWAY_TOKEN = /\b(away|alternate|alternative|visitor|visitante|segunda)\b/;
const THIRD_TOKEN =
  /\b(third|3rd|thirds?|3e|3eme|3ème|troisi[eè]me|tercera|tercero|terceira|terceiro|terzo|terza|drittes?|dritte[nrs]?|derde|tredje)\b/;
const FOURTH_TOKEN =
  /\b(fourth|4th|4e|4eme|4ème|quatri[eè]me|cuarta|cuarto|quarta|quarto|vierte[nrs]?|viertes|vierde|fj[aä]rde|fjerde)\b/;
const GOALKEEPER_TOKEN = /\b(goalkeeper|goal keeper|keepers?|gk|g\.k\.)\b|\bkeeper\s+(shirt|jersey|kit|top)\b/;
const TRAINING_TOKEN = /\b(training|drill|warm[- ]?up)\b/;
const PREMATCH_TOKEN = /\b(pre[- ]?match|prematch)\b/;

export interface ShirtTypeResult {
  type: string | null;
  certain: boolean;
}

export function detectShirtType(text: string): ShirtTypeResult {
  const l = ` ${text.toLowerCase().replace(/[_/|,]+/g, ' ').replace(/\s+/g, ' ')} `;

  // Goalkeeper still takes priority over Training/Pre-Match, same as
  // before - Kickio has no "GK Training"/"GK Pre-Match" variant, so a
  // title naming both ("Goalkeeper Training Top") falls back to the
  // existing GK-qualifier logic below rather than a flat "Training",
  // pending real evidence either way.
  const goalkeeper = GOALKEEPER_TOKEN.test(l);
  if (goalkeeper) {
    if (FOURTH_TOKEN.test(l)) return { type: 'GK Fourth', certain: true };
    if (THIRD_TOKEN.test(l)) return { type: 'GK Third', certain: true };
    if (AWAY_TOKEN.test(l)) return { type: 'GK Away', certain: true };
    if (HOME_TOKEN.test(l)) return { type: 'GK Home', certain: true };
    // Goalkeeper confirmed, but no Home/Away/Third/Fourth qualifier found -
    // default to GK Home, but flag it as uncertain per the guide's rule that
    // Type is one of the fields that "must be certain".
    return { type: 'GK Home', certain: false };
  }

  if (PREMATCH_TOKEN.test(l)) return { type: 'Pre-Match', certain: true };
  if (TRAINING_TOKEN.test(l)) return { type: 'Training', certain: true };

  if (FOURTH_TOKEN.test(l) || /\bfourth[- ]?(choice|kit|strip|shirt|jersey|top)\b/.test(l)) {
    return { type: 'Fourth', certain: true };
  }
  if (THIRD_TOKEN.test(l) || /\bthird[- ]?(choice|kit|strip|shirt|jersey|top)\b/.test(l)) {
    return { type: 'Third', certain: true };
  }
  if (AWAY_TOKEN.test(l) || /\b2nd\s+(shirt|jersey|kit|top|strip)\b/.test(l)) {
    return { type: 'Away', certain: true };
  }
  if (HOME_TOKEN.test(l)) return { type: 'Home', certain: true };

  // No explicit token at all - Home is the documented default, but keep it
  // marked uncertain rather than "certain".
  return { type: 'Home', certain: false };
}

// =========================================================================
// Team (best-effort recovery when no explicit team field was scraped - the
// guide's own recommendation is "send as printed", so this is only used as
// a fallback and is always reported as inferred, never certain).
// =========================================================================

export function guessTeamFromTitle(title: string): string {
  // Strip a trailing " - Site Name" or " | Site Name" suffix - common on
  // scraped page <title>s - by cutting at whichever delimiter appears
  // first, not just the dash form. Cutting at the wrong one (e.g. applying
  // the dash rule when a pipe comes first) would leave the other subtitle's
  // junk in place.
  const dashAt = title.search(/\s[-–—]\s/);
  const pipeAt = title.search(/\s\|\s/);
  const candidates = [dashAt, pipeAt].filter((i) => i >= 0);
  const cutAt = candidates.length ? Math.min(...candidates) : -1;
  const withoutSubtitle = cutAt >= 0 ? title.slice(0, cutAt) : title;

  // A short bare trailing number OR all-caps letter code, with no adjacent
  // size word to anchor on (unlike the "XL 47"/"77 XL" pairs handled
  // below), is still this retailer's own stock code on some listings -
  // confirmed on real listings surviving as "Sevilla 83", "Manchester
  // City 78" (numeric) and "Atletico Madrid HJ" (2-letter - too short for
  // the unconditional 4+ letter all-caps strip elsewhere, which has to
  // stay conservative since it has no other evidence backing it up). The
  // safe way to tell either shape apart from a genuine club number
  // (Hannover 96, Bayer 04 Leverkusen) is word ORDER in the raw title: a
  // real club number always sits immediately next to the team name,
  // before any kit-type word ("Hannover 96 Home Shirt") - this
  // retailer's stock code always comes after one, right at the very end
  // ("... Home Shirt 83"). Computed here, against the raw title, before
  // any stripping below could remove the evidence either way needs.
  const rawNoAsterisks = withoutSubtitle.replace(/\*+/g, '');
  const kitWordMatch = rawNoAsterisks.match(
    /\b(?:Shirts?|Jerseys?|Kits?|Tops?|Tees?|Jackets?|Sweatshirts?|Hoodies?|Home|Away|Third|Fourth|Goalkeeper|GK|Training)\b/i,
  );
  const trailingBareCodeMatch = rawNoAsterisks.match(/\s(\d{1,4}|[A-Z]{2,3})\s*$/);
  const trailingNumberIsStockCode =
    !!kitWordMatch && !!trailingBareCodeMatch && kitWordMatch.index! < trailingBareCodeMatch.index!;

  // A trailing "<one capitalized word> <1-2 digit number>" at the very end,
  // with a kit-type word earlier in the title separating it from the team
  // name, is the seller's own unmarked back-print name + shirt number
  // ("Ibrahimović 9") - the same bare shape extractPlayerNumber/
  // extractPlayerNameFromTitle already recognise elsewhere in this file for
  // the player_name/number fields, just without requiring a "#" marker in
  // front of it. Confirmed on a real listing surviving as "Manchester
  // United Ibrahimović" once only the trailing "9" (read, correctly, as
  // this retailer's own stock code per trailingNumberIsStockCode above) had
  // been stripped, leaving the player's name still attached to the team
  // guess. Deliberately limited to exactly one preceding word - unlike the
  // "#"-marked strip below, which allows up to 3 - so this can never reach
  // back across a quoted aside ("'Antonio Puerta Trophy' Home Shirt 83")
  // and eat into it; gated on kitWordMatch the same way
  // trailingNumberIsStockCode is, so a genuine club number with no kit word
  // anywhere in the title ("Arsenal 96" on its own) is never mistaken for
  // this. Uses \p{L} rather than the narrower À-ÿ (Latin-1 Supplement)
  // range so it also matches Eastern/Central European surnames like
  // "Ibrahimović" ("ć" falls outside À-ÿ) - needs the "u" flag for \p{L}
  // to be recognised.
  const trailingNameNumberMatch = rawNoAsterisks.match(/\b(\p{Lu}[\p{L}'’.-]*)\s+\d{1,2}$/u);
  const trailingNameNumberIsPlayerTag =
    !!kitWordMatch && !!trailingNameNumberMatch && kitWordMatch.index! < trailingNameNumberMatch.index!;

  let c = withoutSubtitle
    .replace(/\*+/g, '')
    // Strip a trailing "<player name> #<number>" span first, while a season
    // digit-group or kit-type word still separates it from the team name at
    // the front of the title. Bounded to at most 3 capitalized words before
    // the "#" (a generous real player-name length) - confirmed on a real
    // listing ("2021-22 Wolves Castore Third Shirt Neto #7") that this was
    // previously unbounded, and every kit-type word ahead of it ("Wolves
    // Castore Third Shirt Neto") is ALSO capitalized in a title-case
    // listing, with nothing to stop the greedy match from eating all the
    // way back through the team name too, wiping out the whole guess. Uses
    // \p{Lu}/\p{Ll} rather than the narrower À-ÿ (Latin-1 Supplement)
    // range so it also matches Eastern/Central European surnames like
    // "Ibrahimović" ("ć" falls outside À-ÿ) - confirmed on a real listing
    // that was surviving as "Manchester United Ibrahimović" with only the
    // trailing "#9" stripped, because this regex previously failed to
    // match the name at all and left it untouched. Each word-slot also
    // excludes recognized kit/noise words (mirroring
    // PLAYER_NAME_NOISE_WORDS below, for the same reason) - confirmed on
    // a real listing ("Athletic Bilbao Match Issue Home Shirt #5" - a
    // blank/number-only match-issue shirt with no real player name at
    // all) that was surviving as "Athletic Bilbao Match": without the
    // exclusion, "Issue Home Shirt" (three ordinary, unrelated capitalized
    // words, not a name) was being read as if it were the player name
    // right before "#5" and stripped along with it, taking "Issue" with
    // it before the later Match-Issue phrase strip ever got a chance to
    // see it as a whole phrase.
    .replace(
      /\b(?:(?!(?:Shirt|Jersey|Kit|Top|Home|Away|Third|Fourth|Issue|Match|Player|Retail|Authentic)\b)\p{Lu}[\p{Ll}']+\s+){0,2}(?!(?:Shirt|Jersey|Kit|Top|Home|Away|Third|Fourth|Issue|Match|Player|Retail|Authentic)\b)\p{Lu}[\p{Ll}']+\s*#\d+/gu,
      '',
    )
    .replace(/#\d+/g, '');
  if (trailingNameNumberIsPlayerTag) {
    c = c.replace(/\s+\p{Lu}[\p{L}'’.-]*\s+\d{1,2}$/u, '').trim();
  }
  c = c
    // Bounded to a 4-digit group that isn't itself part of a longer
    // alphanumeric run - confirmed on real listings surviving as "Italy
    // 76" and "Birmingham BM": the retailer's own numeric stock codes
    // ("765650-02", "BM0071-459") happen to contain a run that LOOKS like
    // this same "####-##" season shape in the middle of them, and an
    // unguarded version of this regex was matching that embedded run and
    // stripping it, leaving only the digits/letters before it behind. A
    // real season is always its own standalone token (bounded by
    // whitespace or the start of the title, e.g. "2022-23 Italy ..."),
    // never glued directly onto other letters or digits like a code is.
    .replace(/(?<![A-Za-z0-9])\d{4}[-/]\d{2,4}(?![A-Za-z0-9])/g, '')
    // A short two-digit retro season ("'94-95'") is sometimes wrapped in
    // its own quotes on this retailer's titles - the leading "'?" here
    // was only ever eating the OPENING quote, never the closing one after
    // the second digit group, so it was leaving that lone trailing quote
    // behind as orphaned punctuation - confirmed on a real listing
    // surviving as "Middlesbrough '" (the whole rest of the title,
    // including the season, stripped cleanly; just that one stray
    // apostrophe left over). Added the missing "'?" after the second
    // \d{2} to strip both quotes symmetrically, same as the fully-quoted
    // shape the later quote-strip below already handles correctly.
    .replace(/(?<![\d/-])'?\d{2}\s*[/-]\s*'?\d{2}'?(?![\d/-])/g, '')
    .replace(/\b\d{4}\b/g, '')
    .replace(/\b(Home|Away|Third|Fourth|Goalkeeper|GK|Training|Pre[- ]?Match)\b/gi, '')
    // A colour word is a qualifier between the team name and the kit-type
    // word ("Arsenal Pink Third Shirt"), not part of the team name itself
    // - left unstripped it gets pulled into the guess the same way an
    // unstripped size word would. Reuses COLOUR_WORDS (the same list
    // detectColours matches against elsewhere in this file) rather than a
    // separate list that could drift out of sync with it.
    .replace(new RegExp(`\\b(${COLOUR_WORDS.map((w) => escapeRegex(w)).join('|')})\\b`, 'gi'), '')
    // "LS" (no slash) is the same long-sleeve marker as "L/S" below, just
    // this retailer's own shorthand for it on some listings - confirmed on
    // a real long-sleeved listing surviving as "Manchester United x
    // George Best LS".
    // "Sweatshirt"/"Hoodie", "Tee", "Jacket" and "Coat" cover this
    // retailer's non-shirt listings (training tops, half-zips,
    // casualwear, jackets, coats), not just match shirts - confirmed on
    // real listings surviving as "Manchester United Essentials 1/4 Zip
    // Sweatshirt", "Arsenal Graphic Tee", "Liverpool Presentation
    // Jacket", and "Juventus Staff Issue Padded Rain Coat".
    // "Shorts"/"Socks"/"Scarves"/"Scarf"/"Boots"/"Pants"/"Trousers"/
    // "Bottoms"/"Tracksuit" are this retailer's own garment-type words for
    // Kickio's non-shirt categories (see detectCategoryFromTitle below),
    // the same shape as "Jacket"/"Coat"/"Sweatshirt"/"Hoodie" already
    // being stripped here - confirmed on real listings surviving as
    // "Italy Walk-Out Pants" and "Hull City Tracksuit Bottoms" once every
    // other noise word around them had already gone.
    .replace(/\b(Shirts?|Jerseys?|Kits?|Tops?|Tees?|Jackets?|Coats?|Sweatshirts?|Hoodies?|Shorts?|Socks?|Scarf|Scarves|Boots?|Pants|Trousers|Bottoms|Tracksuit|Football|L\/S|LS|S\/S|Long Sleeves?|Short Sleeves?)\b/gi, '')
    // "Graphic" and "Presentation" describe the garment style, not the
    // team, on the same casualwear listings above - "Arsenal Graphic Tee"
    // and "Liverpool Presentation Jacket" were otherwise surviving whole.
    // "Anthem Heritage" is Macron's own jacket product-line name, the
    // same family - confirmed on a real listing surviving as "Wrexham
    // Anthem Heritage" once "Jacket" itself was already being stripped.
    // "Drill" is the same shape again for a training top - confirmed on a
    // real listing surviving as "Manchester United Drill" once "Top"
    // itself was already being stripped by the garment-word strip above.
    // "Padded"/"Rain" describe a coat's style the same way "Graphic"/
    // "Presentation" describe a tee/jacket's - confirmed on the same real
    // "Padded Rain Coat" listing as above, once "Coat" itself was already
    // being stripped by the garment-word strip. "Terrace Icons" is
    // another manufacturer product-line name, the same family as "Anthem
    // Heritage" - confirmed on a real listing surviving as "Juventus
    // Terrace Icons". "Ultimate365 Tour"/"WIND.RDY" are adidas's own golf-
    // technical apparel line/fabric-technology names on a real listing
    // surviving as "Manchester United x Ultimate365 Tour WIND.RDY" once
    // "x adidas" itself was already being stripped (see the collab strip
    // below).
    // "Waterproof" is the same style-word shape again, this time on a
    // training top - confirmed on a real listing surviving as "AC Milan
    // Waterproof" once "Training Top" itself was already being stripped.
    // "Walkout"/"Walk-Out" names this retailer's own pre-match-tunnel
    // jacket/trouser product line, not the team - confirmed on real
    // listings surviving as "Middlesbrough ' Walkout" (jacket) and "Italy
    // Walk-Out Pants" (pants). "Academy Pro" is Nike's own kids'-range
    // product-line name, the same family as "Originals"/"Essentials"
    // below - confirmed on a real listing surviving as "England Academy
    // Pro" once "Pre-Match Shirt" itself was already being stripped.
    .replace(/\b(Graphic|Presentation|Anthem Heritage|Drill|Padded|Rain|Terrace Icons|Ultimate365(?:\s+Tour)?|Waterproof|Walk[- ]?Out|Academy Pro)\b/gi, '')
    .replace(/\bWIND\.RDY\b/gi, '')
    // Nike's "Dri-FIT" fabric-technology branding is the same shape as
    // "Ultimate365"/"WIND.RDY" above, not the team - confirmed on a real
    // listing that was surviving as "Barcelona FIT": the collab-name
    // strip further below (anchored to "x <Capitalized word>", up to 3
    // repetitions) was greedily eating "x Kobe " and then also "Dri-" as
    // a second fake collab word (its lowercase-letter class matches the
    // hyphen, so it stops right before the uppercase "FIT"), stranding
    // "FIT" alone - stripping the whole "Dri-FIT" token here, before that
    // collab strip ever runs, removes it in one piece instead.
    .replace(/\bDri-?FIT\b/gi, '')
    // Generalised from a literal "1/4 Zip" to any "<digit>/<digit> Zip"
    // shape (still also handles a "CL " tournament-edition marker
    // directly in front of it, e.g. "adidas CL 1/2 Zip Training Top") -
    // confirmed on a real listing surviving as "AC Milan CL 1/2 Zip"
    // because this was hardcoded to "1/4" only and had no "CL" handling,
    // while other real listings ("Rangers", "Real Madrid", "Aston Villa")
    // already worked fine because they happened to use "1/4 Zip" with no
    // "CL" in front.
    .replace(/\b(?:CL\s+)?\d\/\d\s*Zip\b/gi, '')
    .replace(/\bQuarter[- ]?Zip\b/gi, '')
    // "Match Issue" (no trailing "d") is a distinct phrase from "Match
    // Issued" already covered here, and the correct source for this
    // profile's own Issue field too (canonicalIssue() below already
    // recognises it - this strip just hadn't kept up with it). "Staff
    // Issue" is the same shape again, this retailer's own phrase for
    // team-staff (rather than player-issued) gear - confirmed on a real
    // listing surviving as "Juventus Staff Issue Padded Rain Coat".
    .replace(/\b(BNWT|BNIB|BNWOT|Player Issue|Staff Issue|Match Worn|Match Issued|Match Issue)\b/gi, '')
    // "*w/tags*"/"w/o tags" is a condition note (this retailer's own
    // shorthand for BNWT/BNWOT), not part of the team - confirmed on real
    // listings surviving as "Leeds w/tags" and "Ukraine w/tags JZ4622".
    // The asterisks wrapping it are already gone by this point (stripped
    // above), leaving the bare "w/tags" token to catch here.
    .replace(/\bw\/o?\s*tags?\b/gi, '')
    .replace(/\b(Authentic|Stadium|Replica|Retro|Vintage|Classic|Reissue|Special|Version)\b/gi, '')
    .replace(/\b(Centenary|Anniversary|Commemorative|Jubilee|Basic|Limited Edition)\b/gi, '')
    // A manufacturer's own product-line name ("adidas Originals", "adidas
    // Essentials", "Nike Energy") is not part of the team - confirmed on
    // real listings surviving as "Liverpool Originals LFSTLR", "Manchester
    // United Essentials 1/4 Zip Sweatshirt" and "Norway Energy". The
    // manufacturer word itself ("adidas"/"Nike") is already stripped
    // separately below via the MANUFACTURERS loop.
    .replace(/\b(Originals|Essentials|Energy)\b/gi, '')
    // A manufacturer/retailer collab line ("... x George Best ...") names
    // a tribute or collaboration, not the team - confirmed on a real
    // listing surviving as "Manchester United x George Best LS".
    // Anchored to a standalone "x" token (never matches the "X" fused
    // inside a size like "2XL", since there's no word boundary there)
    // followed by 1-3 genuinely capitalized words, so it can't mistake
    // ordinary lowercase text for a collab name. Each "word" requires at
    // least one lowercase letter after its capital, not just "*" (zero or
    // more) - confirmed on a real listing ("... x George Best Track Pants
    // #7 *BNIB* IV7536") surviving as "Manchester United 7536": with "*",
    // a bare capital letter alone (no lowercase after it) still counted
    // as a whole "word", so this was greedily eating "I" and "V" off the
    // FRONT of the unrelated trailing stock code "IV7536" as two more
    // fake collab-name words, on top of the real "George", stranding the
    // digits with nothing left to anchor the later code strips on.
    .replace(/\b[xX]\b\s+(?:[A-ZÀ-Ý][a-zà-ÿ'’-]+\s*){1,3}/g, '')
    // The collab strip just above requires a genuinely capitalized name
    // to follow "x", by design (see its own comment) - but this
    // retailer sometimes writes a manufacturer collab in lowercase ("x
    // adidas Ultimate365 Tour WIND.RDY"), which that strip correctly
    // leaves alone rather than risk eating ordinary text, and the
    // MANUFACTURERS loop below only removes "adidas" itself, not the "x"
    // in front of it. Confirmed on that same real listing surviving as
    // "Manchester United x Ultimate365 Tour WIND.RDY" once "adidas" had
    // already gone. Safe specifically because it's anchored to this
    // file's own trusted manufacturer list, not any lowercase word.
    .replace(new RegExp(`\\b[xX]\\b\\s+(?:${MANUFACTURERS.map((m) => escapeRegex(m)).join('|')})\\b`, 'gi'), '')
    .replace(/\b\d+\s*(?:st|nd|rd|th)\b/gi, '')
    .replace(/\b\d+\s*Years?\b/gi, '')
    .replace(/\b\d{1,2}\s*\/\s*10\b/g, '')
    // Bare "New" is excluded when directly followed by "Balance" -
    // confirmed on a real listing surviving as "Liverpool Balance": this
    // condition-word strip runs before the MANUFACTURERS loop below, so
    // without the exclusion it was matching just the "New" inside "New
    // Balance" as if it were condition text, leaving "Balance" behind as
    // an orphan once the manufacturer loop no longer had the full phrase
    // "New Balance" left to match against.
    .replace(/\b(As New|Near Mint|Very Good|Brand New|Excellent|Good|Fair|Poor|New(?!\s+Balance)|Used|Mint)\b/gi, '')
    .replace(/\b(Mens|Womens|Women'?s|Men'?s|Kids|Youth|Boys|Girls|Junior|Adult)\b/gi, '')
    .replace(/\bSize\b/gi, '')
    // This retailer always puts its own stock/reference code immediately
    // next to the size (e.g. "... Shirt S 112587", "... Shirt M HA8318",
    // "... Shirt XL 47", or reversed, "... Shirt 77 XL") - stripped as a
    // pair here, anchored to both the end of the title AND an actual size
    // word right next to it. That size anchor is what makes this safe
    // even for a short, alphanumeric, or otherwise-ambiguous code (a bare
    // "47", a mixed "HA8318") that neither a digit-length threshold nor a
    // bare-trailing-size check alone could safely catch. Deliberately
    // placed this late - after every other noise word above (colours,
    // Retro/Vintage/etc., BNWT, condition words, "Mint"...) has already
    // been stripped, but before the unconditional size-word strip just
    // below - confirmed on real listings that were surviving as "England
    // 72" and "France S 57": an intervening noise word originally sitting
    // between the size and the code (e.g. "XL Retro 72") meant this pair
    // wasn't actually adjacent yet the first time an earlier, same-shaped
    // check ran, and by the time that word was stripped later, the size
    // word itself had already been removed too, orphaning the code with
    // nothing left to anchor a strip on. Running this pass here instead,
    // after the noise but before the size word's own removal, means it
    // never misses a pair for that reason again. A real club number
    // (Hannover 96, Bayer 04 Leverkusen) is never preceded by a size word
    // like this, so it's untouched.
    .replace(/\b(?:XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|5XL)\s+[A-Za-z0-9]+$/i, '')
    // The code isn't always after the size - gated to a token that
    // contains at least one digit, unlike the rule above: this side has
    // no size word marking where the team name itself ends, so an
    // all-letters token here could just as easily be a real (if unusual)
    // trailing word in the team name; a digit is what makes it
    // unambiguously a code instead.
    .replace(/\b[A-Za-z]*\d[A-Za-z0-9]*\s+(?:XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|5XL)$/i, '')
    // Spelled-out sizes ("Small mens", "Medium", "Large") are as common in
    // real listing titles as the abbreviated forms right below - Vinted's
    // own titles use them (e.g. "... 20/21. Small mens"), and left
    // unstripped they get pulled into the team guess as if they were part
    // of the name, exactly the way an unstripped "XL" would be.
    .replace(/\bExtra[- ]?Small\b/gi, '')
    .replace(/\bExtra[- ]?Large\b/gi, '')
    .replace(/\b(Small|Medium|Large)\b/gi, '')
    .replace(/\b(XXXL|XXL|XL|XS|2XL|3XL|4XL|5XL|X-?Large|XX-?Large)\b/gi, '')
    // Tournament/competition words are never part of a team's own name -
    // for a national side (the team itself, e.g. "France", should survive,
    // only the tournament label should go) or a club (a cup win being
    // commemorated is not the club's name either) - confirmed on a real
    // listing surviving as "Southampton FA Cup" (a "30th Anniversary" of
    // an FA Cup win, per its own title).
    .replace(
      /\b(World\s*Cup|FIFA|Olympics?|Euro'?s?|Copa\s+America|Africa\s+Cup|AFCON|Nations\s+League|Confederations\s+Cup|FA\s+Cup|League\s+Cup|Community\s+Shield|Champions\s+League|Europa\s+League|Conference\s+League|Super\s+Cup)\b/gi,
      '',
    )
    .replace(/\([^)]*\)/g, '')
    // A quoted aside ("2019 Sevilla Nike 'Antonio Puerta Trophy' Home
    // Shirt") names a special edition/commemoration, not the team - same
    // reasoning as the parenthetical strip just above, just with quotes
    // instead of parens. Anchored to whitespace on both sides so a
    // genuine apostrophe inside a word (a contraction, a name like
    // "N'Golo") is never mistaken for the start/end of a quoted span.
    // Allows EMPTY content between the quotes ("*" not "+") - confirmed
    // on a real listing ("2017-18 Liverpool New Balance '125 Years' Home
    // Shirt") surviving as "Liverpool Balance ''": an earlier strip (the
    // digit+"Years" one, above) had already emptied out "125 Years" from
    // inside the quotes by the time this one ran, and with only "+" this
    // couldn't match (let alone remove) a now-empty quote pair, leaving
    // the bare quote marks behind as their own leftover junk.
    .replace(/(^|\s)'[^']*'(?=\s|$)/g, '$1')
    .replace(/(^|\s)"[^"]*"(?=\s|$)/g, '$1');
  for (const m of MANUFACTURERS) {
    c = c.replace(new RegExp(`\\b${escapeRegex(m)}\\b`, 'gi'), '');
  }
  c = c.replace(/\s*[-–—]\s*$/g, '').replace(/^\s*[-–—]\s*/g, '');
  c = c.replace(/\.\s*$/, '').replace(/\s+/g, ' ').trim();
  c = c.replace(/\bHolland\b/gi, 'Netherlands');
  // A trailing 5+ digit code is the retailer's own stock/reference number,
  // not part of the team - confirmed on a real vintagefootballshirts.com
  // listing ("2003-05 Barcelona Nike Training Shirt S 112587" was
  // surviving as "Barcelona S 112587"). No club, competition or kit
  // descriptor is ever a number that long - unlike a real club number
  // (Hannover 96, Bayer 04 Leverkusen), which is always 4 digits or fewer
  // and deliberately left alone.
  c = c.replace(/\s+\d{5,}$/, '').trim();
  // A trailing stock code that itself contains a hyphen ("765650-02",
  // "BM0071-459", "RAN-002SSA", "95000JV-000") is still this retailer's
  // own SKU, not a club number or season - confirmed on real listings
  // that were surviving as "Italy 76", "Birmingham BM", "Rangers M
  // RAN-002SSA" (the last one preceded by a bare size letter too, which
  // the earlier, narrower size+code pair strip couldn't reach since its
  // own character class doesn't allow a hyphen either), and "Juventus
  // 95000JV-000" (7 characters ahead of the hyphen - longer than the
  // first version of this strip allowed for) before the season-span
  // regex above was guarded against matching a run embedded inside one
  // of these (see its own comment): once that stopped silently absorbing
  // most of the code by accident, the whole shape needed an actual strip
  // of its own, since no other rule here tolerates an internal hyphen.
  // Deliberately generic about which side of the hyphen has the letters
  // (this retailer uses both "digits-hyphen-digits" and "letters-hyphen-
  // alnum" shapes) rather than one narrow pattern per shape seen so far,
  // and generously bounded (originally up to 8 characters either side,
  // widened to 12 after a real listing - "2025-26 West Ham Umbro Away
  // Shirt L/S *w/tags* XXXL TM12552NS-030" - surfaced a 9-character
  // prefix, "TM12552NS", the first version didn't allow for) rather than
  // tuned tightly to only the exact lengths confirmed so far - a real
  // club number or season is never followed by a hyphenated alphanumeric
  // suffix like this at all, regardless of length, so there's no real
  // team name this could accidentally eat into.
  c = c.replace(/\s+[A-Za-z0-9]{1,12}-[A-Za-z0-9]{2,12}$/, '').trim();
  // A short (1-4 digit) trailing number, or a short (2-3 letter) all-caps
  // trailing code, is ALSO this retailer's own stock code, not a club
  // number or a real short abbreviation, specifically when
  // trailingNumberIsStockCode (computed above, against the raw title)
  // says a kit-type word came before it - see that computation for the
  // full reasoning. Deliberately separate from the unconditional 5+
  // digit and 4+ letter strips elsewhere: unlike those, a short bare
  // code alone is genuinely ambiguous with a real club number or team
  // abbreviation, so this only fires with that extra, order-based
  // evidence backing it up.
  if (trailingNumberIsStockCode) {
    c = c.replace(/\s+(\d{1,4}|[A-Z]{2,3})$/, '').trim();
  }
  // A trailing alphanumeric stock/reference code - a couple of letters
  // fused directly onto 3-6 digits with no space ("HA8318", "JZ4622") - is
  // this retailer's own SKU, not part of the team, even with no size word
  // in front of it to anchor on (the earlier size+code strip above only
  // fires when one is). Confirmed on a real listing that survived as
  // "Ukraine w/tags JZ4622" with nothing between the code and the rest of
  // the (already-stripped) title. No genuine team, club-number or kit
  // descriptor ever fuses letters straight onto digits like this - a real
  // club number (Hannover 96, Bayer 04) always has a space before it.
  c = c.replace(/\s+[A-Za-z]{1,3}\d{3,6}$/, '').trim();
  // A trailing alphanumeric code in any other shape - letters and digits
  // mixed together in either order, sometimes with a trailing letter too
  // ("PLY25001R", "NOR25501R"), or a longer hash-like fragment
  // ("HM0H6CA2690QUE") - is still this retailer's own SKU/internal id,
  // not part of the team, even though it doesn't fit the narrower
  // "letters then digits" shape the strip above targets. Requires BOTH a
  // letter and a digit somewhere in the token (a genuine club number or
  // season is always purely numeric, e.g. "Hannover 96") and a minimum
  // length of 5, long enough that it can't coincide with any real
  // shirt-related shorthand.
  c = c.replace(/\s+(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{5,}$/, '').trim();
  // A trailing bare, all-caps alphabetic token (4+ letters, no digits) is
  // this retailer's own style/SKU code once everything recognizable
  // around it has already been stripped - confirmed on a real listing
  // that survived as "Liverpool Originals LFSTLR". A real team name never
  // arrives from this retailer in solid capitals like this (its titles
  // use normal title case throughout), so this can't mistake a genuine
  // trailing word in the team name for a code - unlike a short 2-3 letter
  // abbreviation (PSG, USA), which is common enough as a real team name
  // on its own that it's deliberately left below this length threshold.
  c = c.replace(/\s+[A-Z]{4,}$/, '').trim();
  // A leftover bare single-letter size code at the very end (e.g. "Size M"
  // became just " M" once "Size" was stripped, or "S" once a trailing
  // stock code was stripped off after it) is safe to drop - unlike a bare
  // letter anywhere else in the string, which is left alone since it
  // could be part of a genuine one-word team name. "Y" (youth) is this
  // retailer's own size marker alongside the standard XS-XXXL range -
  // confirmed on a real listing surviving as "Aberdeen Y".
  c = c.replace(/\s+(XXS|XS|S|M|L|XL|XXL|XXXL|Y)$/i, '').trim();
  // Guard against leftover junk (a bare size code, or anything too short to
  // plausibly be a team name) rather than surfacing it as a false "team".
  if (!c || c.length <= 2 || /^(XXS|XS|S|M|L|XL|XXL|XXXL|Y)$/i.test(c)) return '';
  if (c === c.toUpperCase() && c.length > 3) {
    return c.replace(/\b\w+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  }
  return c;
}

// =========================================================================
// Team matching against Kickio's own canonical team list
// =========================================================================

/** Just enough of Kickio's `teams` row to match and display - see lib/kickioTeams.ts on the caller side. */
export interface KickioTeamRef {
  name: string;
  slug: string;
}

export type KickioTeamMatchType = 'exact' | 'normalized' | 'contained';

export interface KickioTeamMatch {
  name: string;
  slug: string;
  matchType: KickioTeamMatchType;
}

// Mirrors Kickio's own public.normalize_team_name() SQL function (strip
// diacritics, punctuation, and common club-designator words, collapse
// whitespace) closely enough for exact/normalized matching here.
// Deliberately NOT a full port: Kickio's own version also feeds a trigram-
// similarity fallback and an authenticated-only `team_aliases` table
// (Wolves -> Wolverhampton Wanderers, PSG -> Paris Saint-Germain, ...) that
// this file's caller - reading via Kickio's public anon/publishable key -
// can't see. Left out entirely rather than guessed at: a hardcoded copy of
// that alias table would silently drift out of sync with Kickio's real one,
// and a bare trigram-similarity threshold picked without seeing real
// mismatches risks false positives more than it resolves. Exact/normalized
// matching alone still confirms the common case (most scraped titles
// already spell a team close enough to its canonical Kickio name); anything
// short of that is deliberately left unmatched (null) rather than guessed.
const CLUB_DESIGNATOR_WORDS =
  /\b(fc|cf|afc|sc|ac|cd|cp|fk|sk|bk|if|sv|tsv|vfl|vfb|club|football|soccer|de|do|the)\b/g;

function normalizeKickioTeamName(s: string): string {
  const noDiacritics = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return noDiacritics
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(CLUB_DESIGNATOR_WORDS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Matches a resolved team string (explicit field or guessTeamFromTitle's
 * best-effort guess) against Kickio's live team list, when the caller has
 * one available - see KickioProfileInput.kickioTeams. Returns null both
 * when nothing matches AND when no list was supplied at all, so a
 * deployment without KICKIO_SUPABASE_URL configured behaves exactly as
 * before rather than flagging every single team as unmatched.
 *
 * `gender` (this profile's own already-resolved gender, e.g. "Mens") is
 * used only to break a tie between otherwise-identical containment
 * candidates that differ by a "Women" suffix (see below) - it never
 * changes an exact/normalized match.
 */
export function matchKickioTeam(
  guess: string,
  teams: readonly KickioTeamRef[],
  gender?: string | null,
): KickioTeamMatch | null {
  const trimmed = guess.trim();
  if (!trimmed) return null;

  const exact = teams.find((t) => t.name.toLowerCase() === trimmed.toLowerCase());
  if (exact) return { name: exact.name, slug: exact.slug, matchType: 'exact' };

  const normalizedGuess = normalizeKickioTeamName(trimmed);
  if (!normalizedGuess) return null;
  const normalized = teams.find((t) => normalizeKickioTeamName(t.name) === normalizedGuess);
  if (normalized) return { name: normalized.name, slug: normalized.slug, matchType: 'normalized' };

  // A short form ("Tottenham", "Leeds", "Blackburn") that's a whole-word
  // match inside (or containing) a canonical name - mirroring the
  // containment step of Kickio's own match_team_smart, just without its
  // alias-table/trigram steps either side of it (same reasoning as
  // above). Confirmed directly against Kickio's live team list: this is
  // NOT always safe to accept on its own - "Rangers" alone genuinely
  // matches 9+ real, unrelated teams there (Carrick Rangers, Queens Park
  // Rangers, Rangers FC (HK), Rangers du Congo, ...), and guessing among
  // them would risk a confidently-wrong match, worse than staying
  // unmatched. So this only ever accepts a containment match when
  // exactly one candidate exists - if there's more than one, "Women" in
  // the candidate's own name is tried once as a tiebreaker against this
  // profile's already-resolved gender (confirmed against a real listing:
  // "Tottenham" alone matches both "Tottenham Hotspur" and "Tottenham
  // Hotspur Women" in Kickio's list), and if that still doesn't leave
  // exactly one, it's left unmatched rather than guessed at.
  const minLen = 4; // same length floor match_team_smart's own containment step uses
  let candidates = teams.filter((t) => {
    const n = normalizeKickioTeamName(t.name);
    if (!n || n.length < minLen) return false;
    return (` ${n} `).includes(` ${normalizedGuess} `) || (` ${normalizedGuess} `).includes(` ${n} `);
  });
  if (candidates.length > 1 && gender) {
    const wantsWomens = /women/i.test(gender);
    const genderMatched = candidates.filter((t) => /\bwomen'?s?\b/i.test(t.name) === wantsWomens);
    if (genderMatched.length > 0) candidates = genderMatched;
  }
  if (candidates.length === 1) {
    return { name: candidates[0].name, slug: candidates[0].slug, matchType: 'contained' };
  }

  return null;
}

// =========================================================================
// Player name + number (Part 2 "Player name" / "Shirt number")
// =========================================================================

// One name-shaped word - any Unicode letter (not just the Latin-1
// Supplement block, À-ÿ - that range misses Eastern/Central European
// letters like "ć"/"č"/"š"/"ž" that show up in real surnames, e.g.
// "Ibrahimović"; \p{L} covers those too), plus an apostrophe or hyphen
// that can appear inside a real surname ("O'Grady", "N'Golo",
// "Alaba-Adeyemi"). Never starts with a digit, so a number can't itself
// be mistaken for "part of a name". Every RegExp built from this needs the
// "u" flag for \p{L} to be recognised.
const NAME_WORD = "[\\p{L}][\\p{L}'’.-]*";
const NAME_WORDS_TAIL = new RegExp(`(?:${NAME_WORD}\\s+){0,2}${NAME_WORD}$`, 'u');

// A single-word (possibly accented, hyphenated, or apostrophised) surname
// immediately followed by a shirt number at the very end of the text, with
// or without a "#" - the common back-print shape a seller types out
// verbatim with no explicit marker at all ("Beckham 7", "Müller 25").
// Deliberately anchored to the very end and limited to one word, unlike
// the marker-based match below: an unmarked bare number floating anywhere
// in a title is genuinely ambiguous with a season, size or price, so this
// stays conservative rather than risk absorbing unrelated preceding words
// (a team abbreviation, a kit-type word) into a false "name".
const TRAILING_NAME_NUMBER = new RegExp(`(${NAME_WORD})\\s+#?(\\d{1,2})$`, 'u');

function stripTrailingSizeCode(text: string): string {
  return text.replace(/\s*\([A-Z0-9]{1,4}\)\s*$/i, '').trimEnd();
}

// Includes generic club-name suffixes (Utd, FC, AFC, CF) alongside the
// kit/type noise words - these are structural regardless of which
// specific club it is (Man Utd, Newcastle Utd, Leeds Utd; Barcelona FC,
// Chelsea FC), so they're as safe to strip as "Shirt"/"Jersey" rather
// than something that needs the actual team name to recognize. This
// matters specifically for a marked-number match with no real player
// name anywhere near it (a blank/number-only shirt) - without it, the
// team-name word immediately preceding the marker could otherwise
// survive as a false "player name" whenever team detection didn't happen
// to use the exact same abbreviated form as the title. "Track"/"Pants"/
// "Bottoms"/"Drill" cover this retailer's training-wear listings the same
// way - confirmed on a real listing ("... x George Best Track Pants #7
// *BNIB* IV7536") surviving as player name "Best Track Pants" instead of
// just "Best".
// "Goalkeeper"/"GK" is the same shape again - confirmed on real listings
// ("1988-90 England Goalkeeper Shirt #1 M", "2000-01 Everton Goalkeeper
// Shirt White #1 M") surviving as player "Goalkeeper" and "Goalkeeper
// White" respectively: #1 is this retailer's own convention for a
// goalkeeper shirt's number, not a back-printed name, and neither title
// has a real surname anywhere in it, but with "Goalkeeper" missing from
// this exclusion list it was being read as if it were one.
// Also reuses COLOUR_WORDS (same list, same reasoning as its own use in
// guessTeamFromTitle - see that comment) - confirmed on a real listing
// ("2000-01 Everton Goalkeeper Shirt White #1 M") surviving as player
// "White": this retailer's own word order here is "<type> Shirt <colour>
// #<number>", not a back-printed name, and without the colour word
// excluded it was the only thing left over once "Goalkeeper"/"Shirt" (see
// above) were already stripped.
const PLAYER_NAME_NOISE_WORDS = new RegExp(
  `\\b(Shirt|Jersey|Kit|Top|Home|Away|Third|Fourth|Goalkeeper|GK|Football|Long Sleeve|Short Sleeve|Authentic|Retail|Player Issue|Reissue|Special|Seller|Feedback|Rated|Rating|Ratings|Reviews?|Stars?|Followers?|Utd|A?FC|Track|Pants|Bottoms|Drill|${COLOUR_WORDS.map((w) => escapeRegex(w)).join('|')})\\b`,
  'gi',
);

function cleanPlayerNameCandidate(raw: string): string | null {
  const cleaned = raw.trim().replace(PLAYER_NAME_NOISE_WORDS, '').trim();
  if (!cleaned || !/[A-Za-zÀ-ÿ]/.test(cleaned)) return null;
  return cleaned;
}

// An explicit, unambiguous marker ("#", "No.", "No", "Number", "Squad
// Number") immediately before a shirt number - unlike a bare floating
// number, this is a strong enough signal to search for anywhere in the
// text (not just at the very end), and to accept a name on either side of
// it ("Ronaldo #7" or "#7 Ronaldo" both read the same way in practice).
const MARKED_NUMBER = /(?:#|\bno\.?\s*|\bnumber\s*|\bsquad\s*number\s*)(\d{1,2})\b/gi;

// Common marketplace phrases ("No.1 seller", "Number 1 rated") that would
// otherwise false-positive on the marker pattern above - a seller's own
// trust badge, not a squad number. Checked against the word immediately
// following the match rather than baked into the marker regex itself, so
// a genuine "#7 Seller's Choice"-style edge case (vanishingly rare) isn't
// what's being guarded against - this specific, common phrase shape is.
const MARKED_NUMBER_FALSE_POSITIVE_FOLLOWERS = new Set([
  'seller', 'sellers', 'feedback', 'rated', 'rating', 'ratings',
  'review', 'reviews', 'star', 'stars', 'follower', 'followers',
]);

interface MarkedNumberMatch {
  index: number;
  length: number;
  digits: string;
}

function findMarkedNumber(text: string): MarkedNumberMatch | null {
  const re = new RegExp(MARKED_NUMBER);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const after = text.slice(m.index + m[0].length).match(/^\s*([A-Za-zÀ-ÿ]+)/);
    if (after && MARKED_NUMBER_FALSE_POSITIVE_FOLLOWERS.has(after[1].toLowerCase())) continue;
    return { index: m.index, length: m[0].length, digits: m[1] };
  }
  return null;
}

export function extractPlayerNumber(text: string): string | null {
  const marked = findMarkedNumber(text);
  if (marked) return marked.digits;
  const tail = stripTrailingSizeCode(text).match(TRAILING_NAME_NUMBER);
  if (!tail || !cleanPlayerNameCandidate(tail[1])) return null;
  return tail[2];
}

export function extractPlayerNameFromTitle(text: string): string | null {
  // A name is read off the words immediately BEFORE a marked number only -
  // "Rooney #10" / "Ronaldo No.7", the well-established convention this
  // already handled correctly for "#". A name written AFTER the number
  // ("#10 Rooney") is deliberately not matched: without real evidence
  // that sellers actually write it that way, guessing at it risks
  // preferring an unrelated word before the marker (a team abbreviation
  // like "Utd") over ever checking after it for the real name.
  const marked = findMarkedNumber(text);
  if (marked) {
    const before = text.slice(0, marked.index).trim().match(NAME_WORDS_TAIL);
    if (before) {
      const cleaned = cleanPlayerNameCandidate(before[0]);
      if (cleaned) return cleaned;
    }
  }

  // No usable name before a marker - fall back to the conservative, end-
  // anchored bare pattern (see TRAILING_NAME_NUMBER above).
  const tail = stripTrailingSizeCode(text).match(TRAILING_NAME_NUMBER);
  if (tail) {
    const cleaned = cleanPlayerNameCandidate(tail[1]);
    if (cleaned) return cleaned;
  }

  return null;
}

/**
 * The back of a shirt is printed in all-caps ("BECKHAM") - a seller
 * copying that straight into a listing is the normal case, not an edge
 * case worth ignoring, so it's worth normalizing on the way out rather
 * than surfacing shouted text as if it were the actual product name.
 * Already mixed-case input (an explicit field, or a name that genuinely
 * includes a mid-word capital like "McTominay") is left untouched rather
 * than force-reformatted, since re-casing it could easily get it wrong.
 */
function properCaseName(name: string): string {
  if (!/[A-Za-z]/.test(name) || name !== name.toUpperCase()) return name;
  return name.replace(/\b\w+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

export function normalizePlayerName(team: string | null, player: string | null): string | null {
  if (!player) return null;
  const p = player.replace(/\s+/g, ' ').trim();
  if (!p) return null;
  if (/^(unknown|n\/?a|none|null|-)$/i.test(p)) return null;
  if (!/[A-Za-zÀ-ÿ]/.test(p)) return null;
  if (!team) return properCaseName(p);
  const t = team.replace(/\s+/g, ' ').trim();
  if (!t) return properCaseName(p);
  if (p.toLowerCase().startsWith(t.toLowerCase() + ' ')) {
    const rest = p.slice(t.length).trim();
    return rest ? properCaseName(rest) : null;
  }
  const teamTokens = new Set(t.toLowerCase().split(/\s+/));
  const words = p.split(/\s+/);
  // Strip every leading team-name token, not just down to one remaining
  // word - a candidate that's ENTIRELY made of team-name tokens (e.g. a
  // captured "Man Utd" leftover fragment from a title like "Man Utd Away
  // Shirt #7" that has no real player name in it at all) has no real name
  // left once they're all gone, and should resolve to null rather than
  // surface a fragment like "Utd" as if it were a genuine player.
  while (words.length > 0 && teamTokens.has(words[0].toLowerCase())) words.shift();
  const rest = words.join(' ').trim();
  return rest ? properCaseName(rest) : null;
}

export function stripManufacturerFromPlayer(player: string | null, manufacturer: string | null): string | null {
  if (!player) return null;
  let p = player.replace(/\s+/g, ' ').trim();
  if (!p) return null;
  const strip = (token: string) => {
    p = p.replace(new RegExp(`\\b${escapeRegex(token)}\\b`, 'gi'), '').replace(/\s+/g, ' ').trim();
  };
  if (manufacturer) strip(manufacturer);
  for (const m of MANUFACTURERS) strip(m);
  return p || null;
}

/** Store the raw number only (no leading '#'); anything not \d{1,3}[A-Za-z]? sanitises to null. */
export function sanitizeShirtNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim().replace(/^#/, '');
  if (!/^\d{1,3}[A-Za-z]?$/.test(s)) return null;
  return s;
}

// =========================================================================
// Size (Part 2 "Size")
// =========================================================================

// Canonical adult range confirmed directly by Kickio: XS-6XL, using "3XL"
// (not "XXXL") for the triple-large step - kickio-shirt-mapping-guide.md's
// own "Recognised source notations" table disagreed with its own "Allowed
// values" list on this exact point, so this was corrected against Kickio's
// direct answer rather than either half of that contradiction.
const SIZE_MAP: Record<string, string> = {
  xs: 'XS', s: 'S', small: 'S', m: 'M', med: 'M', medium: 'M', l: 'L', large: 'L',
  xl: 'XL', xlarge: 'XL', 'x-large': 'XL', 'extra large': 'XL', extralarge: 'XL',
  xxl: 'XXL', '2xl': 'XXL', 'xx-large': 'XXL', xxlarge: 'XXL',
  '3xl': '3XL', xxxl: '3XL', 'xxx-large': '3XL', xxxlarge: '3XL',
  '4xl': '4XL', xxxxl: '4XL', 'xxxx-large': '4XL',
  '5xl': '5XL', xxxxxl: '5XL', 'xxxxx-large': '5XL',
  '6xl': '6XL', xxxxxxl: '6XL', 'xxxxxx-large': '6XL',
};

// Kickio has no "XXS" adult size at all (XS is the smallest) - confirmed
// directly by Kickio: a listing using "XXS" as if it were an adult size is
// really describing a garment cut for a 9-10 year old, not a genuinely
// smaller adult fit, so it maps onto that age band instead of a
// nonexistent adult "XXS" value.
const ADULT_XXS_AGE_BAND = '9-10 Years';

// Kickio's youth sizing is age-band only, not letter sizes - confirmed
// directly by Kickio ("we only work in years (age)"). Maps this
// retailer's own youth letter sizes onto the canonical 2-year bands
// Kickio's list actually runs (`15-16 Years` down to `3-4 Years`),
// following the standard age-band convention used across football-shirt
// junior kit sizing generally (Nike/adidas/Puma junior charts all follow
// this same XS-through-XXL progression). A youth code above XXL/2XL (this
// retailer occasionally writes "Youth 3XL") has no defined band above
// 15-16 Years to map onto, so it's deliberately left unresolved here
// rather than inventing one.
const YOUTH_AGE_MAP: Record<string, string> = {
  xxs: '3-4 Years',
  xs: '5-6 Years',
  s: '7-8 Years', small: '7-8 Years',
  m: '9-10 Years', med: '9-10 Years', medium: '9-10 Years',
  l: '11-12 Years', large: '11-12 Years',
  xl: '13-14 Years', xlarge: '13-14 Years', 'x-large': '13-14 Years',
  xxl: '15-16 Years', '2xl': '15-16 Years',
};

export function extractSizeFromTitle(text: string | null | undefined): string | null {
  if (!text) return null;
  const norm = (raw: string): string | null => {
    if (/^xxs$/i.test(raw)) return ADULT_XXS_AGE_BAND;
    const k = raw.toLowerCase().replace(/\s+/g, '');
    return SIZE_MAP[k] ?? SIZE_MAP[raw.toLowerCase()] ?? null;
  };
  const normYouth = (raw: string): string | null => {
    const k = raw.toLowerCase().replace(/\s+/g, '');
    return YOUTH_AGE_MAP[k] ?? YOUTH_AGE_MAP[raw.toLowerCase()] ?? null;
  };

  const labelled = text.match(/\b(?:size|sz)\s*[:-]?\s*([A-Za-z0-9-]{1,6})\b/i);
  if (labelled) {
    const s = norm(labelled[1]);
    if (s) return s;
  }
  const youth = text.match(
    /\b(youth|boys?|girls?|junior|kids?|child(?:ren)?s?)\s+(xxs|xs|s|small|m|med|medium|l|large|xl|xlarge|x-large|xxl|2xl)\b/i,
  );
  if (youth) {
    const s = normYouth(youth[2]);
    if (s) return s;
  }
  const paren = text.match(/[([]\s*(xxs|xs|s|m|l|xl|xxl|xxxl|2xl|3xl|small|medium|large|xlarge|x-large)\s*[)\]]/i);
  if (paren) {
    const s = norm(paren[1]);
    if (s) return s;
  }
  const explicit = text.match(
    /\b(x-?large|xx-?large|xxx-?large|xxxx-?large|xlarge|xxlarge|xxxlarge|2xl|3xl|4xl|5xl|6xl)\b/i,
  );
  if (explicit) {
    const s = norm(explicit[1]);
    if (s) return s;
  }
  const word = text.match(/\b(small|medium|large)\b/i);
  if (word) {
    const s = norm(word[1]);
    if (s) return s;
  }
  const bare = text.match(/(?:^|\s)(XXS|XS|XL|XXL|XXXL)(?:\s|$|[,./])/);
  if (bare) return norm(bare[1]);

  // A bare single-letter size (S/M/L) with no "Size:" label, brackets, or
  // spelled-out word - confirmed on a real listing ("2022-23 England Nike
  // Away Shirt *w/tags* M") that was mapping no size at all, since every
  // check above requires either a label, brackets, a spelled-out word, or
  // (the unconditional check just above) a 2+ character code. A bare
  // single letter is genuinely ambiguous anywhere else in a title (an
  // initial, an abbreviation - "L/S" for long-sleeve is the real trap:
  // "Manchester City Puma Home Shirt L/S *w/tags* 78" has no size in the
  // title at all), so this is deliberately anchored to the one place this
  // retailer's own title shape actually puts it: right after its own
  // condition marker ("*w/tags*"/"*BNIB*"/etc - "L/S" sits BEFORE that
  // marker, so it's never a candidate here), optionally followed by its
  // own retro/SKU code ("*w/tags* M Retro DN", "*w/tags* XL Retro 72").
  const afterCondition = text.match(
    /\*?\s*(?:w\/o?\s*tags?|bnwt|bnib|bnwot)\s*\*?\s+(xxs|xs|s|m|l|xl|xxl|xxxl|2xl|3xl|4xl|5xl|6xl)\b/i,
  );
  if (afterCondition) {
    const s = norm(afterCondition[1]);
    if (s) return s;
  }
  // Same ambiguity concern, same fix, for a title with no condition
  // marker at all: a bare size is unambiguous when it's the very last
  // word of the title - the same word-order convention this file already
  // relies on elsewhere for this retailer's own trailing stock codes (see
  // guessTeamFromTitle) - a real stock code never happens to equal one of
  // these exact size tokens.
  const trailingBare = text.trim().match(/\b(xxs|xs|s|m|l|xl|xxl|xxxl|2xl|3xl|4xl|5xl|6xl)$/i);
  if (trailingBare) {
    const s = norm(trailingBare[1]);
    if (s) return s;
  }
  return null;
}

/** Shopify-style variant title ("L / Red") - split on '/', try each segment. */
export function extractSizeFromVariant(variantTitle: string | null | undefined): string | null {
  if (!variantTitle) return null;
  const parts = variantTitle.split(/\s*\/\s*/);
  for (const part of parts) {
    const k = part.trim().toLowerCase();
    if (k === 'xxs') return ADULT_XXS_AGE_BAND;
    if (SIZE_MAP[k]) return SIZE_MAP[k];
  }
  return parts[0]?.trim() || null;
}

// =========================================================================
// Condition (Kickio's 5-tier condition ladder + per-retailer overrides)
// =========================================================================

/** Kickio's fixed condition grades - every mapped condition lands on one of these. */
export type ConditionGrade = 'Brand New (With Tags)' | 'Mint' | 'Very Good' | 'Good' | 'Fair' | 'Needs Attention';

/**
 * Retailer-specific condition wording, checked before the generic ladder
 * below. Keyed by hostname (lowercase, no "www."). A retailer's own phrase
 * always wins over a generic guess, since resellers sometimes use terms
 * (grading letters, house-brand labels) that either don't appear in the
 * generic ladder at all or would be misread by it.
 *
 * Only add a row once you've confirmed the exact wording that retailer
 * uses in its own listings - never guessed, for the same reason every
 * other field in this file refuses to invent a value: a wrong override
 * silently outranks the generic ladder for every item on that site.
 *
 * One named section per retailer, each a standalone array ordered from
 * most-specific pattern to least (so e.g. "Very Good" is matched before
 * the bare "Good" it would otherwise also match), merged into the lookup
 * table at the bottom.
 */

// ---- vintagefootballshirts.com ----
// Confirmed from the site's own condition filter facets: As New, BNIB,
// Excellent, Good, Mint, Very good, Very Good, w/tags. "As New" and
// "Excellent" aren't defined by the retailer beyond their facet names -
// treated here as Mint and Very Good respectively (no perceptible wear
// vs. great-but-visibly-used), the more common convention in resale
// grading; revisit if VFS's own usage turns out to rank them differently.
const VINTAGE_FOOTBALL_SHIRTS_CONDITIONS: [RegExp, ConditionGrade][] = [
  [/\bbnib\b/i, 'Brand New (With Tags)'],
  [/w\/\s*tags?\b/i, 'Brand New (With Tags)'],
  [/\bmint\b/i, 'Mint'],
  [/\bas\s*new\b/i, 'Mint'],
  [/\bexcellent\b/i, 'Very Good'],
  [/\bvery\s*good\b/i, 'Very Good'],
  [/\bgood\b/i, 'Good'],
];

export const RETAILER_CONDITION_OVERRIDES: Record<string, [RegExp, ConditionGrade][]> = {
  'vintagefootballshirts.com': VINTAGE_FOOTBALL_SHIRTS_CONDITIONS,
};

/** Hostname (no "www.") to key retailer-specific overrides by, or null if `url` isn't parseable. */
export function retailerHostname(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

export function gradeConditionText(raw: string | null | undefined, hostname?: string | null): ConditionGrade | null {
  if (!raw) return null;
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const l = text.toLowerCase();

  const overrides = hostname ? RETAILER_CONDITION_OVERRIDES[hostname] : undefined;
  if (overrides) {
    for (const [pattern, grade] of overrides) {
      if (pattern.test(l)) return grade;
    }
  }

  const rating = l.match(/\b(\d{1,2})\s*\/\s*10\b/);
  if (rating) {
    const r = parseInt(rating[1], 10);
    if (r === 10) return 'Mint';
    if (r >= 8) return 'Very Good';
    if (r >= 6) return 'Good';
    // Kickio's ladder (kickio-shirt-mapping-guide.md, Part 2) has a
    // distinct Fair tier for 4-5/10, not just Good-vs-Needs Attention -
    // confirmed by cross-referencing this function against that guide,
    // which was missing here entirely (every 4-5/10 rating was silently
    // landing on the much harsher "Needs Attention").
    if (r >= 4) return 'Fair';
    return 'Needs Attention';
  }

  // Vinted-style multilingual condition labels, checked before the ladder.
  if (
    /\bnew\s+with\s+tags?\b|\bnuovo\s+con\s+etichett|\bnuevo\s+con\s+etiquet|\bneuf\s+avec\s+.tiquett|\bneu\s+mit\s+etikett|\bnieuw\s+met\s+label/.test(l)
  )
    return 'Brand New (With Tags)';
  if (
    /\bnew\s+without\s+tags?\b|\bnuovo\s+senza\s+etichett|\bnuevo\s+sin\s+etiquet|\bneuf\s+sans\s+.tiquett|\bneu\s+ohne\s+etikett|\bnieuw\s+zonder\s+label/.test(l)
  )
    return 'Mint';
  if (/\bvery\s+good\b|\bottim\w*\b|\bmuy\s+bueno\b|\btr.s\s+bon\s+.tat|\bsehr\s+gut\b|\bzeer\s+goed\b/.test(l))
    return 'Very Good';
  if (/^good$|\bgood\s+condition\b|\bbuon\w*\b|^bien$|\bbon\s+.tat\b|^gut$|^goed$/.test(l)) return 'Good';
  // Vinted's "Satisfactory"-equivalent labels map to Fair, per the guide -
  // this was returning Needs Attention, a harsher grade than Vinted's own
  // label actually means.
  if (/\bsatisfactor\w*\b|\bdiscret\w*\b|\baceptable\b|\bsatisfaisant\w*\b|\bzufriedenstellend\b|\bredelijk\b/.test(l))
    return 'Fair';

  if (/\bbnwt\b|\bnwt\b|\bbnib\b/.test(l)) return 'Brand New (With Tags)';
  if (/\bdeadstock\b|\bnos\b|\bbrand\s*new\b/.test(l)) return 'Brand New (With Tags)';
  if (/\bbnwot\b|\bnwot\b|near\s*mint|\bmint\b|pristine|perfect\s*condition/.test(l)) return 'Mint';
  if (/excellent|\bvgc\b|great\s*condition|as\s*new/.test(l)) return 'Very Good';
  if (/good\s*condition|\bgood\b/.test(l)) return 'Good';
  // "fair"/"acceptable" map to Fair, per the guide - distinct from the
  // "well used"/"worn"/etc. group just below, which genuinely does mean
  // Needs Attention.
  if (/\bfair\b|acceptable/.test(l)) return 'Fair';
  if (/well\s*used|\bworn\b|poor\s*condition|vintage\s*condition|heavily\s*used/.test(l)) return 'Needs Attention';
  if (/\bpre[- ]?owned\b|\bused\b/.test(l)) return 'Good';
  if (/\bnew\b/.test(l)) return 'Brand New (With Tags)';
  return null;
}

// =========================================================================
// Price (text fallback - only used when neither an explicit price field
// nor structured product data (services/structuredData.ts) yielded one.
// Motivating case: JS-rendered marketplaces like Vinted, whose price never
// lands in a JSON-LD block or meta tag at all, but is always shown as
// plain text on the page itself. Currency detection is symbol/code based,
// not site-specific - this is the same class of generic pattern-matching
// as extractSeason/detectColours above, not a guessed value.
// =========================================================================

const CURRENCY_SYMBOLS: Record<string, string> = { '£': 'GBP', $: 'USD', '€': 'EUR' };

// `index`/`length` locate the matched price within `text` - used
// elsewhere (see buildKickioProfile's stock-status section) to pull a
// window of text immediately around a listing's own price, rather than
// trusting an entire page's worth of scraped markdown, when looking for
// stock-status wording that's specific to THIS product rather than
// sitewide boilerplate elsewhere on the page.
export function extractPriceFromText(
  text: string,
): { price: number; currency: string; index: number; length: number } | null {
  const symbolMatch = text.match(/([£$€])\s*(\d{1,6}(?:[.,]\d{2})?)\b/);
  if (symbolMatch) {
    const amount = parseFloat(symbolMatch[2].replace(',', '.'));
    if (Number.isFinite(amount)) {
      return {
        price: amount,
        currency: CURRENCY_SYMBOLS[symbolMatch[1]],
        index: symbolMatch.index!,
        length: symbolMatch[0].length,
      };
    }
  }
  const codeMatch = text.match(/\b(\d{1,6}(?:[.,]\d{2})?)\s*(GBP|USD|EUR)\b/i);
  if (codeMatch) {
    const amount = parseFloat(codeMatch[1].replace(',', '.'));
    if (Number.isFinite(amount)) {
      return {
        price: amount,
        currency: codeMatch[2].toUpperCase(),
        index: codeMatch.index!,
        length: codeMatch[0].length,
      };
    }
  }
  return null;
}

// =========================================================================
// Other field canonicalizers (Part 2 - direct to their final enum value;
// each falls back to the documented default, never a guess)
// =========================================================================

export function detectManufacturer(text: string): string | null {
  for (const brand of MANUFACTURERS) {
    if (new RegExp(`\\b${escapeRegex(brand)}\\b`, 'i').test(text)) return brand;
  }
  return null;
}

export function canonicalManufacturer(v: string | null | undefined): string | null {
  if (!v) return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  const match = MANUFACTURERS.find((m) => m.toLowerCase() === trimmed.toLowerCase());
  return match ?? trimmed;
}

/**
 * Find up to `max` distinct colour words mentioned in free text, in the
 * order they appear - the "main" colours a human skimming the title would
 * name first. Longer, more specific phrases ("sky blue") are matched ahead
 * of their bare form ("blue") because COLOUR_WORDS lists them first and the
 * combined pattern tries alternatives in that order at each position.
 */
export function detectColours(text: string, max = 2): Array<{ raw: string; canonical: string | null }> {
  const padded = ` ${text.toLowerCase()} `;
  const pattern = new RegExp(
    // The trailing boundary is a lookahead, not a consumed group - two
    // colour words separated by a single delimiter ("Red White", "Red,
    // White") would otherwise have that shared character eaten by the
    // first match, leaving nothing for the second match's own leading
    // boundary to consume.
    `(?:^|[\\s,;|/(])(${COLOUR_WORDS.map((w) => escapeRegex(w.toLowerCase())).join('|')})(?=[\\s,;|/)]|$)`,
    'g',
  );
  const out: Array<{ raw: string; canonical: string | null }> = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(padded)) !== null) {
    const raw = m[1];
    if (!seen.has(raw)) {
      seen.add(raw);
      out.push({ raw, canonical: COLOUR_MAP[raw] ?? null });
      if (out.length >= max) break;
    }
  }
  return out;
}

export function canonicalColour(v: string | null | undefined): string | null {
  if (!v) return null;
  return COLOUR_MAP[v.toLowerCase()] ?? null;
}

// Plain-English phrases. Checked ahead of the shorter/riskier bare-word
// signals below so a specific phrase always wins over a loose one.
const OUT_OF_STOCK_PHRASES =
  /\b(out of stock|sold out|no longer available|no longer in stock|not currently available|currently unavailable|temporarily unavailable|not available|item unavailable|unavailable|discontinued|item sold|this item has sold|listing (?:has )?ended|no stock|zero stock)\b/i;
const IN_STOCK_PHRASES =
  /\b(in stock|add to (cart|basket|bag)|buy now|available now|available to buy|still available|ready to ship|ships (?:today|now|immediately)|in-stock)\b/i;

// Bare, standalone markers common on reseller/marketplace listings ("SOLD"
// stamped over a photo, an item marked "Reserved" for another buyer). Kept
// separate from the phrase lists above and checked afterwards since a bare
// word carries more false-positive risk than a specific phrase - e.g. "sold"
// could in principle appear in unrelated marketing copy - but the tradeoff
// is worth it: these are extremely common on exactly the kind of vintage/
// resale listings Kickcrawl targets, and a false negative (missing a real
// "SOLD" stamp) is worse here than a rare false positive.
const OUT_OF_STOCK_BARE_WORDS = /\b(sold|reserved)\b/i;

// schema.org Offer.availability values, as either the full URL
// ("https://schema.org/OutOfStock") or the bare enum token some sites emit
// in a data attribute or extracted field ("OutOfStock", "outofstock").
const SCHEMA_OUT_OF_STOCK = /\b(outofstock|soldout|discontinued)\b/i;
const SCHEMA_IN_STOCK = /\b(instock|limitedavailability)\b/i;

// "3 in stock", "1 left", "0 remaining" - a decisive count, so parsed before
// any word-based signal. Checked against the SAME text as everything else,
// not just an explicit field, since this phrasing shows up in titles and
// descriptions too ("Only 1 left!").
const STOCK_COUNT_PATTERN = /\b(\d+)\s*(?:x\s*)?(?:in stock|left(?:\s+in\s+stock)?|remaining|available)\b/i;
const LAST_ONE_PATTERN = /\b(last one|last item|final one|only one left)\b/i;

// A size swatch a Shopify theme disables on the page also carries a
// "Sold out" label right next to it for screen-reader accessibility - a
// real, but per-SIZE, signal, not a per-PRODUCT one. Confirmed on a real
// listing ("Nike TM Swoosh Fleece Hoodie *w/tags*") whose Large size was
// greyed out while Medium stayed selectable, with a live "Add to Bag"/
// Apple Pay checkout on the page - and neither its description, reviews,
// nor "you may also like" section (everything visibly readable on the
// page) mentioned stock/sold/unavailable anywhere at all, ruling out
// sitewide boilerplate as the cause the same way it explained every
// earlier case this session. Since Kickio's own listing model captures
// one size per entry, what matters is whether THAT size is purchasable,
// not whether every size on the page is - so an out-of-stock word/phrase
// sitting right next to a size word is read as describing that one
// variant and stripped before the decisive checks below ever see it,
// rather than sinking the whole listing over an unrelated sold-out size.
//
// Deliberately requires TWO OR MORE consecutive size words (only
// whitespace between them, no dash) immediately before/after the stock
// wording, not just one - a real single-item marketplace listing's own
// size sitting next to a genuine "SOLD" stamp ("Arsenal Home Shirt M -
// SOLD") must still be trusted (confirmed by this file's own existing
// test), and that shape has exactly one size word, normally separated
// from "SOLD" by a dash rather than running straight into it. Multiple
// consecutive size words with nothing between them is specifically what
// a Shopify variant-swatch list looks like once flattened to text - a
// shape a single-item listing's own size mention essentially never has.
const SIZE_WORD_FOR_VARIANT_NOISE =
  '(?:XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL|4XL|5XL|6XL|Small|Medium|Large|Extra[- ]?Small|Extra[- ]?Large)';
const TWO_OR_MORE_SIZE_WORDS = `\\b${SIZE_WORD_FOR_VARIANT_NOISE}\\b(?:\\s+\\b${SIZE_WORD_FOR_VARIANT_NOISE}\\b)+`;
const VARIANT_STOCK_NOISE = new RegExp(
  `${TWO_OR_MORE_SIZE_WORDS}\\s+\\b(sold\\s*out|sold|reserved|unavailable|out of stock)\\b` +
    `|\\b(sold\\s*out|sold|reserved|unavailable|out of stock)\\b\\s+${TWO_OR_MORE_SIZE_WORDS}`,
  'gi',
);
function stripVariantStockNoise(s: string): string {
  return s.replace(VARIANT_STOCK_NOISE, ' ');
}

// The actual root cause of nearly every VFS false "Out of Stock" this
// session, found by temporarily logging the real text behind one and
// reading it directly (not guessed): this retailer's theme has a "Unit
// price" line under the price (the per-kg/per-item price-breakdown
// feature many Shopify themes ship, e.g. "£3.00 / 100g") that reads
// "Unit price / **Unavailable**" as its own placeholder on literally
// every product that doesn't have unit pricing configured - which is
// nearly all of them here - confirmed present, in that exact position,
// on every single one of 400+ real listings pulled from a live crawl,
// with zero connection to the product's real availability (many were
// confirmed purchasable with a live "Add to Bag" button on the same real
// page). OUT_OF_STOCK_PHRASES has a bare "unavailable" alternative, and
// because this boilerplate sits immediately next to the price, it always
// fell inside the price-window this file already narrows phraseText to,
// so it was never excluded by any earlier fix here. Stripped as its own
// exact, anchored phrase ("Unit price" + optional "/" + "Unavailable")
// rather than by loosening/removing "unavailable" from OUT_OF_STOCK_PHRASES
// itself, since a genuine "This item is unavailable" elsewhere in real
// page text is still a real signal worth keeping.
const UNIT_PRICE_UNAVAILABLE_NOISE = /\bunit\s*price\b\s*\/?\s*\*{0,2}unavailable\*{0,2}/gi;
function stripUnitPriceNoise(s: string): string {
  return s.replace(UNIT_PRICE_UNAVAILABLE_NOISE, ' ');
}

// A phrase that sits entirely alone on its own markdown line/paragraph
// (blank line - or the start/end of the text - immediately before AND
// after it, with nothing else sharing that line) is a UI widget's own
// text - a button label, a status badge - not incidental prose mentioning
// the word somewhere in a sentence. That's a different, narrower kind of
// evidence than "appears somewhere in this window of text", so it's safe
// to check across the FULL page text rather than staying inside
// PRICE_PROXIMITY_WINDOW below - confirmed by construction against this
// file's own worst real false-positive source: this retailer's "Unit
// price / **Unavailable**" boilerplate (see stripUnitPriceNoise above)
// never matches here even though "unavailable" is one of the phrases,
// because "Unit price /" shares that same line, so the phrase isn't
// alone on it.
//
// Added after a real, still-recurring "Unknown" case (a genuinely sold
// out listing, "2019-20 Arsenal adidas Originals '91-93 Away Shirt
// *BNIB*") turned out to have its real, current stock status nowhere
// near its price at all - a Shopify sticky/mobile quick-buy summary
// widget, placed near the very end of the page, entirely outside the
// price-proximity window: "...Arsenal / BNIB / Small -
// [Change](#product-info)\n\nSold out\n\n[Trustpilot]...". Found by
// capturing and reading the real text directly (a temporary production
// diagnostic), not guessed.
function standaloneLineVariant(phraseRegex: RegExp): RegExp {
  const inner = phraseRegex.source.replace(/^\\b\(/, '').replace(/\)\\b$/, '');
  return new RegExp(`(?:^|\\n\\s*\\n)\\s*\\*{0,2}(${inner})\\*{0,2}\\s*(?=\\n\\s*\\n|$)`, 'i');
}
const STANDALONE_LINE_OUT_OF_STOCK = standaloneLineVariant(OUT_OF_STOCK_PHRASES);
const STANDALONE_LINE_IN_STOCK = standaloneLineVariant(IN_STOCK_PHRASES);

/**
 * Availability signal, checked in order of how decisive/specific it is.
 * `phraseText`/`bareWordText` have any size-adjacent "sold"/"out of
 * stock" wording (a per-variant signal, not a per-product one - see
 * stripVariantStockNoise's own comment) stripped before any of steps 4-6
 * below ever see them:
 *  1. An explicit numeric quantity (0 is decisive either way).
 *  2. A "<N> left/remaining/in stock/available" count in `text`.
 *  3. "Last one" / "only one left" in `text` - still purchasable, just low stock.
 *  4. schema.org's Offer.availability enum, in URL or bare-token form, in `phraseText`.
 *  5. A specific out-of-stock phrase, then a specific in-stock phrase, in `phraseText`.
 *  6. A bare marketplace marker ("SOLD", "Reserved") in `bareWordText`.
 * "Sold out"/"out of stock" wins over a lingering "Add to cart" button when
 * both are present, since disabled buttons commonly stay in the markup
 * after an item sells out. Never guessed from absence alone: `null` means
 * there was no text to check at all, 'Unknown' means there was text but
 * none of the above signals matched it.
 *
 * Steps 4-6 deliberately do NOT scan the raw, full `text` (which also
 * carries a scraped page's full description/markdown, up to 4000 chars) -
 * confirmed on multiple real, genuinely-in-stock listings ("2021-22
 * Liverpool Nike Away Shirt", "2012-13 Tottenham Under Armour Away
 * Shirt", "2020-21 Scotland adidas Home Shirt", all with live "Add to
 * Bag"/Apple Pay checkout buttons on the page, none with structured
 * availability data for this codebase to fall back to instead) that this
 * codebase kept reporting "Out of Stock" for: this retailer's own
 * sitewide boilerplate (getContentHtml() in services/mainContent.ts only
 * strips literal <nav>/<header>/<footer> tags, and this retailer's theme
 * wraps its real nav/footer/trust-badge/chat-widget markup in plain
 * <div>s instead, so sitewide text survives into every page's
 * description - the same contamination this file already found and
 * fixed for shirt_type/issue/specialEdition on this exact retailer) only
 * needs ONE stray out-of-stock-sounding word or phrase anywhere in up to
 * 4000 characters of that boilerplate (a "12 shirts sold this month"
 * trust badge, an unrelated recommended item shown as sold out, a chat
 * widget reading "Agents currently unavailable") to false-positive a
 * real, purchasable listing.
 *  - `bareWordText` (title + any explicit stock field only) is the
 *    narrowest scope, for the single riskiest signal - a bare "sold"/
 *    "reserved" with zero surrounding context, already flagged by this
 *    file's own OUT_OF_STOCK_BARE_WORDS comment as its most guessable
 *    pattern.
 *    (omitting it falls back to the full `text`, same as before this
 *    param existed). Built by buildKickioProfile as a window of text
 *    immediately around the listing's own detected price (see its own
 *    use of extractPriceFromText's match position) rather than the full
 *    page, or the same narrow scope as `bareWordText` when no price
 *    position is available to window around. A specific, complete phrase like
 *    "Sold Out"/"£25 Sold out" sitting right next to a product's own
 *    price is real, necessary signal recheckWorker's own sale-detection
 *    relies on for retailers with no dedicated title marker (confirmed
 *    by its own existing test) - but that locality (price-adjacent, not
 *    page-wide) is exactly what distinguishes a real per-product signal
 *    from incidental sitewide text describing something else entirely.
 */
export function detectStockStatus(
  text: string | null | undefined,
  quantity?: number | null,
  bareWordText?: string | null,
  phraseText?: string | null,
): 'In Stock' | 'Out of Stock' | 'Unknown' | null {
  if (typeof quantity === 'number' && Number.isFinite(quantity)) {
    return quantity <= 0 ? 'Out of Stock' : 'In Stock';
  }
  if (!text) return null;

  const countMatch = text.match(STOCK_COUNT_PATTERN);
  if (countMatch) return parseInt(countMatch[1], 10) > 0 ? 'In Stock' : 'Out of Stock';
  if (LAST_ONE_PATTERN.test(text)) return 'In Stock';

  const p = stripUnitPriceNoise(stripVariantStockNoise(phraseText ?? text));
  if (SCHEMA_OUT_OF_STOCK.test(p)) return 'Out of Stock';
  if (SCHEMA_IN_STOCK.test(p)) return 'In Stock';

  if (OUT_OF_STOCK_PHRASES.test(p)) return 'Out of Stock';
  if (IN_STOCK_PHRASES.test(p)) return 'In Stock';

  // Full-text fallback for the one shape the price-proximity window can't
  // reach: a phrase alone on its own line/paragraph, wherever on the page
  // it actually sits - see standaloneLineVariant's own comment.
  const fullTextNoNoise = stripUnitPriceNoise(stripVariantStockNoise(text));
  if (STANDALONE_LINE_OUT_OF_STOCK.test(fullTextNoNoise)) return 'Out of Stock';
  if (STANDALONE_LINE_IN_STOCK.test(fullTextNoNoise)) return 'In Stock';

  if (OUT_OF_STOCK_BARE_WORDS.test(stripVariantStockNoise(bareWordText ?? text))) return 'Out of Stock';

  return 'Unknown';
}

export function canonicalGender(text: string): string {
  const l = text.toLowerCase();
  if (/\b(kids|children'?s|children)\b/.test(l)) return 'Kids';
  if (/\bunisex\b/.test(l)) return 'Unisex';
  if (/\b(women'?s|women|female)\b/.test(l)) return 'Womens';
  return 'Mens';
}

export function canonicalSleeves(text: string): string {
  const l = text.toLowerCase();
  if (/\bl\/s\b/.test(l) || /long[\s-]?sleeved?/.test(l)) return 'Long-Sleeved';
  return 'Short-Sleeved';
}

export function canonicalIssue(text: string): string {
  const l = text.toLowerCase();
  if (l.includes('match worn')) return 'Match Worn';
  if (l.includes('match issue') || l.includes('match issued')) return 'Match Issue';
  if (l.includes('player') || l.includes('authentic')) return 'Authentic/Player Version';
  if (l.includes('reissue')) return 'Reissue';
  return 'Standard Retail Version';
}

export function canonicalSpecialEdition(text: string): string {
  const l = text.toLowerCase();
  if (l.includes('anniversary')) return 'Anniversary';
  if (l.includes('centenary')) return 'Centenary';
  if (l.includes('champions league')) return 'Champions League';
  if (l.includes('champions')) return 'Champions';
  if (l.includes('collaboration') || l.includes('collab')) return 'Collaboration';
  if (l.includes('cup final')) return 'Cup Final';
  if (l.includes('euro')) return "Euro's";
  if (l.includes('limited')) return 'Limited Edition';
  if (l.includes('pre-season') || l.includes('preseason')) return 'Pre-Season';
  if (l.includes('testimonial')) return 'Testimonial';
  if (l.includes('world cup')) return 'World Cup';
  if (l.includes('special')) return 'Special Edition';
  return 'Not A Special Edition';
}

export function canonicalSigned(text: string): string {
  const l = text.toLowerCase();
  return l.includes('signed') || l.includes('autograph') ? 'Signed' : 'Not Signed';
}

export function canonicalBoxed(text: string): string {
  const l = text.toLowerCase();
  return l.includes('box') ? 'Boxed Edition - In Box' : 'Not A Boxed Edition';
}

function resolveCategory(raw: string | null): string {
  if (!raw) return 'Football Shirts';
  const slug = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const match = LIVE_CATEGORIES.find((c) => c.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') === slug);
  return match ?? 'Football Shirts';
}

// A jacket/coat or hoodie/sweatshirt listing needs its own Kickio category,
// not the "Football Shirts" default it would otherwise silently fall back
// to - confirmed on real listings ("Wrexham Macron Anthem Heritage
// Jacket", "Liverpool adidas Presentation Jacket", "Manchester United
// adidas Essentials 1/4 Zip Sweatshirt") that this codebase's own
// team-name parser already recognizes as non-shirt garment types (it
// strips "Jacket"/"Sweatshirt" as noise words there), while category
// resolution only ever looked at an explicit site-configured field and
// otherwise always defaulted to Football Shirts regardless of what the
// title actually said. Scoped to the title alone, like every other
// keyword-matched field with a default (shirt_type, issue, etc. above) -
// same reasoning: sitewide boilerplate elsewhere on the page shouldn't be
// able to override a real per-listing signal.
function detectCategoryFromTitle(title: string): string | null {
  if (/\b(jackets?|coats?)\b/i.test(title)) return 'Jackets/Coats';
  if (/\b(hoodies?|sweatshirts?|sweat\s*tops?)\b/i.test(title)) return 'Hoodies/Sweat Tops';
  // Confirmed the same gap exists for Shorts: "Arsenal Adidas Home
  // Shorts" was defaulting to Football Shirts AND picking up a
  // shirt_type ("Home") as if it were an actual shirt. Word-boundary
  // matched so it can't fire on "Short-Sleeved"/"Short Sleeve" (singular
  // "Short", not "Shorts").
  if (/\bshorts\b/i.test(title)) return 'Shorts';
  // Same category (and same shirt_type-leak) gap confirmed for the rest
  // of Kickio's real, live category list (queried directly from its
  // `categories` table) that this function simply had no branch for yet:
  // "2016-17 Crystal Palace Macron Away Socks" and "2016-17 Crystal
  // Palace Macron Goalkeeper Socks" (real listings), "PSV 'Martin Glas'
  // Scarf" (real listing), "adidas X Speedportal.1 FG Football Boots
  // *BNIB* GW84428" (real listing).
  if (/\bsocks?\b/i.test(title)) return 'Socks';
  if (/\bscarf|scarves\b/i.test(title)) return 'Scarves';
  if (/\bboots?\b/i.test(title)) return 'Boots';
  // Tracksuit bottoms/pants have no dedicated Kickio category (checked
  // against the same live `categories` table - there is no "Trousers" or
  // "Pants" row) - confirmed on real listings "2009 Italy Puma
  // Confederations Cup Walk-Out Pants *BNIB* XL 736053-002" and "2024-25
  // Hull City Kappa Walkout Tracksuit Bottoms *BNIB* 37216IW", both of
  // which were otherwise defaulting to Football Shirts and picking up a
  // bogus "Home" shirt_type the same way Shorts/Socks/Scarves/Boots did.
  if (/\b(tracksuit\s*)?(pants|trousers|bottoms)\b/i.test(title)) return 'Other';
  return null;
}

// =========================================================================
// Main entry point
// =========================================================================

export function buildKickioProfile(input: KickioProfileInput): KickioProfile {
  const title = (input.title ?? '').trim();
  const description = (input.description ?? '').trim();
  const haystack = `${title} ${description}`.trim();
  const extracted = input.extracted ?? null;

  const images = [
    ...new Set((input.images ?? []).filter((i): i is string => !!i && i.trim().length > 0)),
  ];
  const hostname = retailerHostname(input.url);

  const confidence: Record<string, Confidence> = {};
  const reviewReasons: string[] = [];

  const category = resolveCategory(
    caseInsensitiveGet(extracted, 'category', 'productType', 'productCategory') ?? detectCategoryFromTitle(title),
  );
  const isJacket = category === 'Jackets/Coats';
  // Type is a *required* Kickio field with no "Not Applicable"-style
  // escape hatch (its real enum is strictly Home/Away/Third/Fourth/GK
  // Home/GK Away/GK Third/GK Fourth - confirmed against the live
  // product_features seed), so defaulting it to "Home" on anything that
  // isn't actually a shirt is actively wrong, not just uncertain -
  // confirmed on real listings that were doing exactly that: "Arsenal
  // Adidas Home Shorts" -> Shorts/Home, "2025-26 Liverpool adidas Home
  // Socks" -> (mis-categorised as) Football Shirts/Home, "2009 Italy
  // Puma Confederations Cup Walk-Out Pants" -> (mis-categorised as)
  // Football Shirts/Home. The isJacket-only guard below already caught
  // Jackets/Coats; this widens the same guard to every non-shirt
  // category now that detectCategoryFromTitle recognises all of them.
  const isShirtCategory = category === 'Football Shirts';

  // ---- Team ----
  const explicitTeam = caseInsensitiveGet(extracted, 'team', 'club', 'teamName');
  let team: string | null = explicitTeam;
  if (team) {
    confidence.team = 'certain';
  } else {
    const guessed = guessTeamFromTitle(title);
    if (guessed) {
      team = guessed;
      confidence.team = 'inferred';
      reviewReasons.push('team inferred from title text, not confirmed by an explicit field');
    } else {
      team = null;
      reviewReasons.push('team could not be determined from the available text');
    }
  }
  // ---- Season ----
  const explicitSeason = caseInsensitiveGet(extracted, 'season', 'seasonReleased', 'year');
  let season: string | null = null;
  let extraSeasons: string[] = [];
  if (explicitSeason) {
    const r = extractSeasonSpan(explicitSeason);
    season = r.season || null;
    extraSeasons = r.extraSeasons;
  } else {
    // Try the title alone first, and only fall back to the full haystack
    // (title + up to 4000 chars of the page's own markdown) when the title
    // itself has nothing. Confirmed against a real Vinted item: its page
    // markdown's boilerplate legal footer contains standard UK legislation
    // citation URLs (".../2013/3134/regulation/29",
    // ".../2015/15/contents/enacted") that this same regex reads as two
    // DIFFERENT "YYYY-YY" season ranges - the "more than one distinct
    // season" ambiguity guard then correctly bails to blank, just on
    // garbage nowhere near the actual listing, before ever reaching the
    // real "22/23" sitting right there in the title. Since the season is
    // almost always in the title when it's anywhere at all, checking it in
    // isolation first keeps the ambiguity guard meaningful instead of
    // firing on unrelated page furniture (nav breadcrumbs, "similar
    // items", legal disclaimers).
    const fromTitle = extractSeasonSpan(title);
    const r = fromTitle.season ? fromTitle : extractSeasonSpan(haystack);
    season = r.season || null;
    extraSeasons = r.extraSeasons;
  }
  if (season) {
    confidence.season = 'certain';
  } else {
    reviewReasons.push('season could not be parsed, or the title mentions more than one distinct season/year');
  }

  // ---- Shirt type / jacket has no shirt_type ----
  // Scoped to the title alone (not haystack) for this and every other
  // keyword-matched field below that has a "default when nothing found"
  // (Home, Standard Retail Version, Not Signed, ...) - confirmed in
  // production on vintagefootballshirts.com: nearly every item was coming
  // back "Authentic/Player Version" and a plain away shirt showed as
  // "Fourth", because getContentHtml() (services/mainContent.ts) only
  // strips literal <nav>/<header>/<footer> tags, and this retailer's theme
  // (like many Shopify themes) wraps its real nav/footer in plain <div>s
  // instead - so a sitewide "Shop by Player" link or a stray "cuarta"
  // in hidden locale-switcher markup survived into every page's haystack
  // and silently overrode the correct default. The title is always
  // seller-authored and specific to this one listing - and this retailer's
  // own titles already spell out "Player Issue", "Away", etc. explicitly
  // when true (e.g. "2023-24 England Nike Player Issue Pre-Match Shirt") -
  // so there's no legitimate signal being given up by not also trawling
  // the rest of the page for these particular fields.
  let shirtType: string | null = null;
  if (isShirtCategory) {
    const explicitType = caseInsensitiveGet(extracted, 'type', 'shirtType', 'kitType');
    const r = detectShirtType(explicitType ?? title);
    shirtType = r.type;
    if (r.type) {
      confidence.shirt_type = r.certain ? 'certain' : 'inferred';
      // Was a hardcoded "defaulted to Home" regardless of what r.type
      // actually was - confirmed misleading on every real "Goalkeeper
      // Shirt" listing with no Home/Away/Third/Fourth qualifier (e.g.
      // "2022-23 Manchester United adidas Goalkeeper Shirt M H64059"):
      // detectShirtType() correctly defaults an unqualified goalkeeper
      // shirt to "GK Home", not "Home" (see its own comment), but this
      // message told a reviewer it had defaulted to "Home" either way.
      if (!r.certain) {
        reviewReasons.push(`no explicit Home/Away/Third/Fourth/GK keyword found - type defaulted to ${r.type}`);
      }
    }
  }

  // ---- Gender ----
  const explicitGender = caseInsensitiveGet(extracted, 'gender', 'department');
  const gender = canonicalGender(explicitGender && /\b(kids|women)/i.test(explicitGender) ? explicitGender : title);

  // Computed here (after gender, not right after team above) so the
  // containment-match tiebreaker inside matchKickioTeam can use this
  // profile's already-resolved gender - see its own comment.
  const kickioTeamMatch = team && input.kickioTeams ? matchKickioTeam(team, input.kickioTeams, gender) : null;

  // ---- Issue / Special edition / Signed / Boxed (shirts only) ----
  let issue: string | null = null;
  let specialEdition: string | null = null;
  let signed: string | null = null;
  let boxed: string | null = null;
  if (!isJacket) {
    issue = canonicalIssue(caseInsensitiveGet(extracted, 'issue') ?? title);
    signed = canonicalSigned(caseInsensitiveGet(extracted, 'signed') ?? title);
  } else {
    signed = canonicalSigned(caseInsensitiveGet(extracted, 'signed') ?? title);
  }
  specialEdition = canonicalSpecialEdition(caseInsensitiveGet(extracted, 'specialEdition', 'edition') ?? title);
  boxed = canonicalBoxed(caseInsensitiveGet(extracted, 'boxedEdition', 'boxed') ?? title);

  // ---- Sleeves (shirts only) ----
  const sleeves = isJacket ? null : canonicalSleeves(caseInsensitiveGet(extracted, 'sleeves') ?? title);

  // ---- Player + number (shirts only) ----
  let player: string | null = null;
  let number: string | null = null;
  if (!isJacket) {
    const explicitPlayer = caseInsensitiveGet(extracted, 'player', 'playerName');
    const explicitNumber = caseInsensitiveGet(extracted, 'number', 'playerNumber', 'shirtNumber');
    // Title first, description only as a fallback when the title itself
    // has nothing - the same "narrowest scope that could plausibly have
    // it, widen only on a miss" strategy already used for season parsing.
    // A player name/number is almost always in the title when it's
    // anywhere at all, and description is the page's own markdown (up to
    // 4000 chars of nav breadcrumbs, "similar items", legal boilerplate),
    // not a clean product description - scanning it unconditionally would
    // risk the exact kind of false match season parsing already hit once.
    let rawPlayer = explicitPlayer ?? extractPlayerNameFromTitle(title) ?? extractPlayerNameFromTitle(description);
    rawPlayer = normalizePlayerName(team, rawPlayer);
    const manufacturerForStrip =
      caseInsensitiveGet(extracted, 'manufacturer', 'brand') ?? detectManufacturer(title) ?? detectManufacturer(haystack);
    rawPlayer = stripManufacturerFromPlayer(rawPlayer, manufacturerForStrip);
    player = rawPlayer;
    number = sanitizeShirtNumber(
      explicitNumber ?? extractPlayerNumber(title) ?? extractPlayerNumber(description),
    );
  }

  // ---- Manufacturer ----
  // Title first, full haystack only as a fallback when the title alone
  // found nothing - unlike type/issue/signed/etc above, there's no
  // "default" here for a stray haystack match to wrongly override (a
  // manufacturer nav list matching first is still a real risk, e.g. a
  // "Shop by Brand" link naming every brand on every page), so a genuine
  // haystack-only mention is still worth recovering rather than leaving
  // this blank.
  const explicitManufacturer = caseInsensitiveGet(extracted, 'manufacturer', 'brand');
  let manufacturer: string | null = null;
  if (explicitManufacturer) {
    manufacturer = canonicalManufacturer(explicitManufacturer);
  } else {
    manufacturer = detectManufacturer(title) ?? detectManufacturer(haystack);
  }

  // ---- Colour (main two) ----
  const explicitColour = caseInsensitiveGet(extracted, 'colour', 'color');
  let colour: string | null = null;
  let colourSecondary: string | null = null;
  if (explicitColour) {
    const parts = explicitColour
      .split(/[,/]/)
      .map((p) => p.trim())
      .filter(Boolean)
      .slice(0, 2);
    const mapped = parts.map((p) => ({ raw: p, canonical: canonicalColour(p) }));
    colour = mapped[0]?.canonical ?? null;
    colourSecondary = mapped[1]?.canonical ?? null;
    for (const p of mapped) {
      if (!p.canonical) reviewReasons.push(`colour "${p.raw}" is not in Kickio's fixed palette`);
    }
  } else {
    // Same title-first, haystack-as-fallback reasoning as manufacturer -
    // colour has no wrong-default risk, only a "found nothing" one.
    const fromTitle = detectColours(title, 2);
    const detected = fromTitle.length > 0 ? fromTitle : detectColours(haystack, 2);
    colour = detected[0]?.canonical ?? null;
    colourSecondary = detected[1]?.canonical ?? null;
    for (const d of detected) {
      if (!d.canonical) reviewReasons.push(`colour "${d.raw}" is not in Kickio's fixed palette`);
    }
  }

  // ---- Condition ----
  const explicitCondition = caseInsensitiveGet(extracted, 'condition');
  let condition: string | null = null;
  if (explicitCondition) {
    condition = gradeConditionText(explicitCondition, hostname);
    if (!condition) {
      condition = explicitCondition; // guide: pass the raw string through rather than dropping it
      reviewReasons.push(`condition text "${explicitCondition}" did not match Kickio's condition ladder`);
    }
  } else {
    // Title first, haystack as a fallback - condition wording (BNIB, w/
    // tags, Mint, ...) is often stated right in this retailer's own
    // titles, and a bare word like "good" or "new" is exactly the kind of
    // thing sitewide boilerplate (nav, footer, "New arrivals") would
    // otherwise false-positive on.
    condition = gradeConditionText(title, hostname) ?? gradeConditionText(haystack, hostname);
  }

  // ---- Size ----
  const explicitSize = caseInsensitiveGet(extracted, 'size', 'variant');
  const size = explicitSize
    ? extractSizeFromVariant(explicitSize) ?? extractSizeFromTitle(explicitSize) ?? explicitSize
    : extractSizeFromTitle(title);

  // ---- Price / currency / quantity ----
  const explicitPrice = input.price ?? (() => {
    const raw = caseInsensitiveGet(extracted, 'price');
    if (!raw) return null;
    const n = Number(raw.replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? n : null;
  })();

  let rawPrice = explicitPrice;
  let rawCurrency = (input.currency ?? caseInsensitiveGet(extracted, 'currency') ?? 'GBP').toUpperCase();
  // Kept outside the block below (not just a local) so the stock-status
  // section further down can window around WHERE in the haystack the
  // price actually sat, not just what it was - see its own comment.
  let priceMatchInHaystack: { index: number; length: number } | null = null;
  if (rawPrice == null) {
    const textPrice = extractPriceFromText(haystack);
    if (textPrice) {
      rawPrice = textPrice.price;
      rawCurrency = textPrice.currency;
      priceMatchInHaystack = { index: textPrice.index, length: textPrice.length };
      confidence.price = 'inferred';
      reviewReasons.push('price read from page text - no explicit price field or structured product data was found');
    }
  }

  // Kickio is a GBP-denominated UK marketplace - a listing priced in
  // another currency gets converted using an admin-maintained approximate
  // rate (currencyRates, from the currency_rates table) rather than shown
  // in its original currency. This is deliberately not a live/exact FX
  // rate - "never invent a value" still applies, so a currency with no
  // configured rate is left as-scraped (and flagged for review) instead of
  // guessing one.
  let price = rawPrice;
  let currency = rawCurrency;
  let originalPrice: number | null = null;
  let originalCurrency: string | null = null;
  let fxRateUsed: number | null = null;
  if (rawPrice != null && rawCurrency !== 'GBP') {
    const rate = input.currencyRates?.[rawCurrency];
    if (rate != null) {
      price = Math.round(rawPrice * rate * 100) / 100;
      currency = 'GBP';
      originalPrice = rawPrice;
      originalCurrency = rawCurrency;
      fxRateUsed = rate;
      confidence.price = 'inferred';
    } else {
      reviewReasons.push(`no GBP conversion rate configured for currency "${rawCurrency}"`);
    }
  }

  const quantity = input.quantity ?? 1;

  // ---- Stock status ----
  // Use the raw (un-defaulted) quantity here - `quantity` above already
  // fell back to 1 when absent, which would otherwise make every listing
  // with no real quantity signal look "in stock".
  const rawQuantity =
    input.quantity ??
    (() => {
      const raw = caseInsensitiveGet(extracted, 'quantity');
      if (!raw) return null;
      const n = Number(raw.replace(/[^0-9.]/g, ''));
      return Number.isFinite(n) ? n : null;
    })();
  const explicitStock = caseInsensitiveGet(
    extracted,
    'stock',
    'stockStatus',
    'availability',
    'availabilityStatus',
    'inStock',
    'inventory',
    'inventoryStatus',
    'stockLevel',
    'productAvailability',
  );
  // `stockText` (counts only - the single lowest false-positive-risk
  // signal, a real per-product inventory count) still scans the full
  // haystack. `stockBareWordText` (the single highest-risk signal - a
  // bare "sold"/"reserved" with no other context, see detectStockStatus's
  // own comment) is the narrowest: the explicit field plus the TITLE
  // only, never `description`/the rest of the page markdown, which this
  // retailer's own sitewide boilerplate has already been confirmed (for
  // other fields) to leak into.
  const stockText = explicitStock ? `${explicitStock} ${haystack}` : haystack;
  const stockBareWordText = explicitStock ? `${explicitStock} ${title}` : title;
  // `stockPhraseText` (schema tokens + full phrases like "Sold Out") is a
  // window of the haystack immediately around this listing's OWN detected
  // price, not the full page - real per-product commerce text (price, buy
  // button, delivery banner) sits together on the page, while this
  // retailer's sitewide boilerplate (nav, trust badges, chat widgets,
  // unrelated recommended items) generally doesn't. Falls back to the
  // same narrow scope as stockBareWordText when there's no price position
  // to window around (an explicit price field, or no price found at all)
  // - without a price to anchor on, there's no way to tell a real
  // per-product phrase apart from incidental sitewide text either.
  const PRICE_PROXIMITY_WINDOW = 500;
  const stockPhraseText = priceMatchInHaystack
    ? haystack.slice(
        Math.max(0, priceMatchInHaystack.index - PRICE_PROXIMITY_WINDOW),
        priceMatchInHaystack.index + priceMatchInHaystack.length + PRICE_PROXIMITY_WINDOW,
      )
    : stockBareWordText;
  const stockStatus = detectStockStatus(stockText, rawQuantity, stockBareWordText, stockPhraseText);

  // ---- Jacket style custom attribute ----
  const customAttributes: Record<string, string> = {};
  if (isJacket) {
    const style = caseInsensitiveGet(extracted, 'jacketStyle', 'style', 'jacketType', 'typeOfJacket', 'coatStyle');
    if (style) {
      customAttributes['jacket-style'] = style;
      confidence['custom_attributes.jacket-style'] = 'certain';
    } else {
      customAttributes['jacket-style'] = 'Jacket';
      confidence['custom_attributes.jacket-style'] = 'inferred';
    }
  }

  const needsReview = reviewReasons.length > 0;

  return {
    source: {
      marketplace: input.marketplace ?? null,
      url: input.url,
      scraped_at: input.scrapedAt ?? new Date().toISOString(),
    },
    category,
    identity: {
      team,
      team_kickio_match: kickioTeamMatch?.name ?? null,
      season,
      extra_seasons: extraSeasons,
      shirt_type: shirtType,
      gender,
      issue,
      special_edition: specialEdition,
      sleeves,
      signed,
      player,
      number,
    },
    listing: {
      condition,
      size,
      manufacturer,
      colour,
      colour_secondary: colourSecondary,
      boxed_edition: boxed,
      price,
      currency,
      original_price: originalPrice,
      original_currency: originalCurrency,
      fx_rate_used: fxRateUsed,
      quantity,
      images,
      stock_status: stockStatus,
    },
    custom_attributes: customAttributes,
    confidence,
    needs_review: needsReview,
    review_reason: needsReview ? reviewReasons.join('; ') : null,
  };
}
