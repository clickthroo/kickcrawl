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
  'Soka', 'Stanno', 'Toffs', 'Topper', 'Uhlsport', 'Umbro', 'Under Armour', 'Vandanel',
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
  informationalOnly: boolean;
}

export function detectShirtType(text: string): ShirtTypeResult {
  const l = ` ${text.toLowerCase().replace(/[_/|,]+/g, ' ').replace(/\s+/g, ' ')} `;

  const goalkeeper = GOALKEEPER_TOKEN.test(l);
  if (goalkeeper) {
    if (FOURTH_TOKEN.test(l)) return { type: 'GK Fourth', certain: true, informationalOnly: false };
    if (THIRD_TOKEN.test(l)) return { type: 'GK Third', certain: true, informationalOnly: false };
    if (AWAY_TOKEN.test(l)) return { type: 'GK Away', certain: true, informationalOnly: false };
    if (HOME_TOKEN.test(l)) return { type: 'GK Home', certain: true, informationalOnly: false };
    // Goalkeeper confirmed, but no Home/Away/Third/Fourth qualifier found -
    // default to GK Home, but flag it as uncertain per the guide's rule that
    // Type is one of the fields that "must be certain".
    return { type: 'GK Home', certain: false, informationalOnly: false };
  }

  // Training/Pre-Match have no dedicated Kickio Type enum value (Part 2) -
  // don't force them into Home/Away.
  if (TRAINING_TOKEN.test(l) || PREMATCH_TOKEN.test(l)) {
    return { type: null, certain: false, informationalOnly: true };
  }

  if (FOURTH_TOKEN.test(l) || /\bfourth[- ]?(choice|kit|strip|shirt|jersey|top)\b/.test(l)) {
    return { type: 'Fourth', certain: true, informationalOnly: false };
  }
  if (THIRD_TOKEN.test(l) || /\bthird[- ]?(choice|kit|strip|shirt|jersey|top)\b/.test(l)) {
    return { type: 'Third', certain: true, informationalOnly: false };
  }
  if (AWAY_TOKEN.test(l) || /\b2nd\s+(shirt|jersey|kit|top|strip)\b/.test(l)) {
    return { type: 'Away', certain: true, informationalOnly: false };
  }
  if (HOME_TOKEN.test(l)) return { type: 'Home', certain: true, informationalOnly: false };

  // No explicit token at all - Home is the documented default, but keep it
  // marked uncertain rather than "certain".
  return { type: 'Home', certain: false, informationalOnly: false };
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
    // way back through the team name too, wiping out the whole guess.
    .replace(/\b(?:[A-ZÀ-Ý][a-zà-ÿ']+\s+){0,2}[A-ZÀ-Ý][a-zà-ÿ']+\s*#\d+/g, '')
    .replace(/#\d+/g, '')
    .replace(/\d{4}[-/]\d{2,4}/g, '')
    .replace(/(?<![\d/-])'?\d{2}\s*[/-]\s*'?\d{2}(?![\d/-])/g, '')
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
    // "Sweatshirt"/"Hoodie" and "1/4 Zip" cover this retailer's casualwear
    // listings (training tops, half-zips), not just match shirts -
    // confirmed on a real listing surviving as "Manchester United
    // Essentials 1/4 Zip Sweatshirt".
    .replace(/\b(Shirts?|Jerseys?|Kits?|Tops?|Sweatshirts?|Hoodies?|Football|L\/S|LS|S\/S|Long Sleeves?|Short Sleeves?)\b/gi, '')
    .replace(/\b1\/4\s*Zip\b/gi, '')
    .replace(/\bQuarter[- ]?Zip\b/gi, '')
    .replace(/\b(BNWT|BNIB|BNWOT|Player Issue|Match Worn|Match Issued)\b/gi, '')
    // "*w/tags*"/"w/o tags" is a condition note (this retailer's own
    // shorthand for BNWT/BNWOT), not part of the team - confirmed on real
    // listings surviving as "Leeds w/tags" and "Ukraine w/tags JZ4622".
    // The asterisks wrapping it are already gone by this point (stripped
    // above), leaving the bare "w/tags" token to catch here.
    .replace(/\bw\/o?\s*tags?\b/gi, '')
    .replace(/\b(Authentic|Stadium|Replica|Retro|Vintage|Classic|Reissue|Special|Version)\b/gi, '')
    .replace(/\b(Centenary|Anniversary|Commemorative|Jubilee|Basic)\b/gi, '')
    // A manufacturer's own product-line name ("adidas Originals", "adidas
    // Essentials") is not part of the team - confirmed on real listings
    // surviving as "Liverpool Originals LFSTLR" and "Manchester United
    // Essentials 1/4 Zip Sweatshirt". The manufacturer word itself
    // ("adidas") is already stripped separately below via the
    // MANUFACTURERS loop.
    .replace(/\b(Originals|Essentials)\b/gi, '')
    // A manufacturer/retailer collab line ("... x George Best ...") names
    // a tribute or collaboration, not the team - confirmed on a real
    // listing surviving as "Manchester United x George Best LS".
    // Anchored to a standalone "x" token (never matches the "X" fused
    // inside a size like "2XL", since there's no word boundary there)
    // followed by 1-3 genuinely capitalized words, so it can't mistake
    // ordinary lowercase text for a collab name.
    .replace(/\b[xX]\b\s+(?:[A-ZÀ-Ý][a-zà-ÿ'’-]*\s*){1,3}/g, '')
    .replace(/\b\d+\s*(?:st|nd|rd|th)\b/gi, '')
    .replace(/\b\d+\s*Years?\b/gi, '')
    .replace(/\b\d{1,2}\s*\/\s*10\b/g, '')
    .replace(/\b(As New|Near Mint|Very Good|Brand New|Excellent|Good|Fair|Poor|New|Used|Mint)\b/gi, '')
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
    // Tournament words are never part of a national team's own name (the
    // team itself, e.g. "France", should survive - only the tournament
    // label should go).
    .replace(/\b(World\s*Cup|FIFA|Olympics?|Euro'?s?|Copa\s+America|Africa\s+Cup|AFCON|Nations\s+League|Confederations\s+Cup)\b/gi, '')
    .replace(/\([^)]*\)/g, '')
    // A quoted aside ("2019 Sevilla Nike 'Antonio Puerta Trophy' Home
    // Shirt") names a special edition/commemoration, not the team - same
    // reasoning as the parenthetical strip just above, just with quotes
    // instead of parens. Anchored to whitespace on both sides so a
    // genuine apostrophe inside a word (a contraction, a name like
    // "N'Golo") is never mistaken for the start/end of a quoted span.
    .replace(/(^|\s)'[^']+'(?=\s|$)/g, '$1')
    .replace(/(^|\s)"[^"]+"(?=\s|$)/g, '$1');
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
  // could be part of a genuine one-word team name.
  c = c.replace(/\s+(XXS|XS|S|M|L|XL|XXL|XXXL)$/i, '').trim();
  // Guard against leftover junk (a bare size code, or anything too short to
  // plausibly be a team name) rather than surfacing it as a false "team".
  if (!c || c.length <= 2 || /^(XXS|XS|S|M|L|XL|XXL|XXXL)$/i.test(c)) return '';
  if (c === c.toUpperCase() && c.length > 3) {
    return c.replace(/\b\w+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  }
  return c;
}

// =========================================================================
// Player name + number (Part 2 "Player name" / "Shirt number")
// =========================================================================

// One name-shaped word - letters (incl. accented), plus an apostrophe or
// hyphen that can appear inside a real surname ("O'Grady", "N'Golo",
// "Alaba-Adeyemi"). Never starts with a digit, so a number can't itself
// be mistaken for "part of a name".
const NAME_WORD = "[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.-]*";
const NAME_WORDS_TAIL = new RegExp(`(?:${NAME_WORD}\\s+){0,2}${NAME_WORD}$`);

// A single-word (possibly accented, hyphenated, or apostrophised) surname
// immediately followed by a shirt number at the very end of the text, with
// or without a "#" - the common back-print shape a seller types out
// verbatim with no explicit marker at all ("Beckham 7", "Müller 25").
// Deliberately anchored to the very end and limited to one word, unlike
// the marker-based match below: an unmarked bare number floating anywhere
// in a title is genuinely ambiguous with a season, size or price, so this
// stays conservative rather than risk absorbing unrelated preceding words
// (a team abbreviation, a kit-type word) into a false "name".
const TRAILING_NAME_NUMBER = new RegExp(`(${NAME_WORD})\\s+#?(\\d{1,2})$`);

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
// to use the exact same abbreviated form as the title.
const PLAYER_NAME_NOISE_WORDS =
  /\b(Shirt|Jersey|Kit|Top|Home|Away|Third|Fourth|Football|Long Sleeve|Short Sleeve|Authentic|Retail|Player Issue|Reissue|Special|Seller|Feedback|Rated|Rating|Ratings|Reviews?|Stars?|Followers?|Utd|A?FC)\b/gi;

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

const SIZE_MAP: Record<string, string> = {
  xxs: 'XXS', xs: 'XS', s: 'S', small: 'S', m: 'M', med: 'M', medium: 'M', l: 'L', large: 'L',
  xl: 'XL', xlarge: 'XL', 'x-large': 'XL', 'extra large': 'XL', extralarge: 'XL',
  xxl: 'XXL', '2xl': 'XXL', 'xx-large': 'XXL', xxlarge: 'XXL',
  xxxl: 'XXXL', '3xl': 'XXXL', 'xxx-large': 'XXXL', xxxlarge: 'XXXL',
  '4xl': '4XL', xxxxl: '4XL',
};

export function extractSizeFromTitle(text: string | null | undefined): string | null {
  if (!text) return null;
  const norm = (raw: string): string | null => {
    const k = raw.toLowerCase().replace(/\s+/g, '');
    return SIZE_MAP[k] ?? SIZE_MAP[raw.toLowerCase()] ?? null;
  };

  const labelled = text.match(/\b(?:size|sz)\s*[:-]?\s*([A-Za-z0-9-]{1,6})\b/i);
  if (labelled) {
    const s = norm(labelled[1]);
    if (s) return s;
  }
  const youth = text.match(
    /\b(youth|boys?|girls?|junior|kids?|child(?:ren)?s?)\s+(xxs|xs|s|small|m|med|medium|l|large|xl|xlarge|x-large|xxl|2xl|xxxl|3xl)\b/i,
  );
  if (youth) {
    const s = norm(youth[2]);
    if (s) return `Youth ${s}`;
  }
  const paren = text.match(/[([]\s*(xxs|xs|s|m|l|xl|xxl|xxxl|2xl|3xl|small|medium|large|xlarge|x-large)\s*[)\]]/i);
  if (paren) {
    const s = norm(paren[1]);
    if (s) return s;
  }
  const explicit = text.match(/\b(x-?large|xx-?large|xxx-?large|xlarge|xxlarge|xxxlarge|2xl|3xl|4xl)\b/i);
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
  if (bare) return bare[1].toUpperCase();
  return null;
}

/** Shopify-style variant title ("L / Red") - split on '/', try each segment. */
export function extractSizeFromVariant(variantTitle: string | null | undefined): string | null {
  if (!variantTitle) return null;
  const parts = variantTitle.split(/\s*\/\s*/);
  for (const part of parts) {
    const k = part.trim().toLowerCase();
    if (SIZE_MAP[k]) return SIZE_MAP[k];
  }
  return parts[0]?.trim() || null;
}

// =========================================================================
// Condition (Kickio's 5-tier condition ladder + per-retailer overrides)
// =========================================================================

/** Kickio's fixed condition grades - every mapped condition lands on one of these. */
export type ConditionGrade = 'Brand New (With Tags)' | 'Mint' | 'Very Good' | 'Good' | 'Needs Attention';

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
  if (/\bsatisfactor\w*\b|\bdiscret\w*\b|\baceptable\b|\bsatisfaisant\w*\b|\bzufriedenstellend\b|\bredelijk\b/.test(l))
    return 'Needs Attention';

  if (/\bbnwt\b|\bnwt\b|\bbnib\b/.test(l)) return 'Brand New (With Tags)';
  if (/\bdeadstock\b|\bnos\b|\bbrand\s*new\b/.test(l)) return 'Brand New (With Tags)';
  if (/\bbnwot\b|\bnwot\b|near\s*mint|\bmint\b|pristine|perfect\s*condition/.test(l)) return 'Mint';
  if (/excellent|\bvgc\b|great\s*condition|as\s*new/.test(l)) return 'Very Good';
  if (/good\s*condition|\bgood\b/.test(l)) return 'Good';
  if (/\bfair\b|acceptable/.test(l)) return 'Needs Attention';
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

export function extractPriceFromText(text: string): { price: number; currency: string } | null {
  const symbolMatch = text.match(/([£$€])\s*(\d{1,6}(?:[.,]\d{2})?)\b/);
  if (symbolMatch) {
    const amount = parseFloat(symbolMatch[2].replace(',', '.'));
    if (Number.isFinite(amount)) return { price: amount, currency: CURRENCY_SYMBOLS[symbolMatch[1]] };
  }
  const codeMatch = text.match(/\b(\d{1,6}(?:[.,]\d{2})?)\s*(GBP|USD|EUR)\b/i);
  if (codeMatch) {
    const amount = parseFloat(codeMatch[1].replace(',', '.'));
    if (Number.isFinite(amount)) return { price: amount, currency: codeMatch[2].toUpperCase() };
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

/**
 * Availability signal, checked in order of how decisive/specific it is:
 *  1. An explicit numeric quantity (0 is decisive either way).
 *  2. A "<N> left/remaining/in stock/available" count in the text.
 *  3. "Last one" / "only one left" - still purchasable, just low stock.
 *  4. schema.org's Offer.availability enum, in URL or bare-token form.
 *  5. A specific out-of-stock phrase, then a specific in-stock phrase.
 *  6. A bare marketplace marker ("SOLD", "Reserved").
 * "Sold out"/"out of stock" wins over a lingering "Add to cart" button when
 * both are present, since disabled buttons commonly stay in the markup
 * after an item sells out. Never guessed from absence alone: `null` means
 * there was no text to check at all, 'Unknown' means there was text but
 * none of the above signals matched it.
 */
export function detectStockStatus(
  text: string | null | undefined,
  quantity?: number | null,
): 'In Stock' | 'Out of Stock' | 'Unknown' | null {
  if (typeof quantity === 'number' && Number.isFinite(quantity)) {
    return quantity <= 0 ? 'Out of Stock' : 'In Stock';
  }
  if (!text) return null;

  const countMatch = text.match(STOCK_COUNT_PATTERN);
  if (countMatch) return parseInt(countMatch[1], 10) > 0 ? 'In Stock' : 'Out of Stock';
  if (LAST_ONE_PATTERN.test(text)) return 'In Stock';

  if (SCHEMA_OUT_OF_STOCK.test(text)) return 'Out of Stock';
  if (SCHEMA_IN_STOCK.test(text)) return 'In Stock';

  if (OUT_OF_STOCK_PHRASES.test(text)) return 'Out of Stock';
  if (IN_STOCK_PHRASES.test(text)) return 'In Stock';

  if (OUT_OF_STOCK_BARE_WORDS.test(text)) return 'Out of Stock';

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

  const category = resolveCategory(caseInsensitiveGet(extracted, 'category', 'productType', 'productCategory'));
  const isJacket = category === 'Jackets/Coats';

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
  if (!isJacket) {
    const explicitType = caseInsensitiveGet(extracted, 'type', 'shirtType', 'kitType');
    const r = detectShirtType(explicitType ?? title);
    shirtType = r.type;
    if (r.informationalOnly) {
      reviewReasons.push('title indicates a Training/Pre-Match kit - Kickio has no dedicated Type value for this');
    } else if (r.type) {
      confidence.shirt_type = r.certain ? 'certain' : 'inferred';
      if (!r.certain) reviewReasons.push('no explicit Home/Away/Third/Fourth/GK keyword found - type defaulted to Home');
    }
  }

  // ---- Gender ----
  const explicitGender = caseInsensitiveGet(extracted, 'gender', 'department');
  const gender = canonicalGender(explicitGender && /\b(kids|women)/i.test(explicitGender) ? explicitGender : title);

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
  if (rawPrice == null) {
    const textPrice = extractPriceFromText(haystack);
    if (textPrice) {
      rawPrice = textPrice.price;
      rawCurrency = textPrice.currency;
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
  // Scan the explicit field (if the site has one) together with the title/
  // description, not instead of it - a bare "SOLD" stamp is far more likely
  // to show up in the title itself than in a dedicated stock field, which
  // most sites Kickcrawl scrapes won't have configured at all.
  const stockText = explicitStock ? `${explicitStock} ${haystack}` : haystack;
  const stockStatus = detectStockStatus(stockText, rawQuantity);

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
