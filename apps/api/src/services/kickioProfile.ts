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
    // the front of the title - that separator is what stops this unbounded
    // capitalized-word run from eating backwards into a multi-word team
    // name once those separators are removed later.
    .replace(/\b(?:[A-ZÀ-Ý][a-zà-ÿ']+\s+)*[A-ZÀ-Ý][a-zà-ÿ']+\s*#\d+/g, '')
    .replace(/#\d+/g, '')
    .replace(/\d{4}[-/]\d{2,4}/g, '')
    .replace(/(?<![\d/-])'?\d{2}\s*[/-]\s*'?\d{2}(?![\d/-])/g, '')
    .replace(/\b\d{4}\b/g, '')
    .replace(/\b(Home|Away|Third|Fourth|Goalkeeper|GK|Training|Pre[- ]?Match)\b/gi, '')
    .replace(/\b(Shirts?|Jerseys?|Kits?|Tops?|Football|L\/S|S\/S|Long Sleeves?|Short Sleeves?)\b/gi, '')
    .replace(/\b(BNWT|BNIB|BNWOT|Player Issue|Match Worn|Match Issued)\b/gi, '')
    .replace(/\b(Authentic|Stadium|Replica|Retro|Vintage|Classic|Reissue|Special|Version)\b/gi, '')
    .replace(/\b(Centenary|Anniversary|Commemorative|Jubilee|Basic)\b/gi, '')
    .replace(/\b\d+\s*(?:st|nd|rd|th)\b/gi, '')
    .replace(/\b\d+\s*Years?\b/gi, '')
    .replace(/\b\d{1,2}\s*\/\s*10\b/g, '')
    .replace(/\b(As New|Near Mint|Very Good|Brand New|Excellent|Good|Fair|Poor|New|Used|Mint)\b/gi, '')
    .replace(/\b(Mens|Womens|Women'?s|Men'?s|Kids|Youth|Boys|Girls|Junior|Adult)\b/gi, '')
    .replace(/\bSize\b/gi, '')
    .replace(/\b(XXXL|XXL|XL|XS|2XL|3XL|4XL|5XL|X-?Large|XX-?Large)\b/gi, '')
    // Tournament words are never part of a national team's own name (the
    // team itself, e.g. "France", should survive - only the tournament
    // label should go).
    .replace(/\b(World\s*Cup|FIFA|Olympics?|Euro'?s?|Copa\s+America|Africa\s+Cup|AFCON|Nations\s+League|Confederations\s+Cup)\b/gi, '')
    .replace(/\([^)]*\)/g, '');
  for (const m of MANUFACTURERS) {
    c = c.replace(new RegExp(`\\b${escapeRegex(m)}\\b`, 'gi'), '');
  }
  c = c.replace(/\s*[-–—]\s*$/g, '').replace(/^\s*[-–—]\s*/g, '');
  c = c.replace(/\.\s*$/, '').replace(/\s+/g, ' ').trim();
  c = c.replace(/\bHolland\b/gi, 'Netherlands');
  // A leftover bare single-letter size code at the very end (e.g. "Size M"
  // became just " M" once "Size" was stripped) is safe to drop - unlike a
  // bare letter anywhere else in the string, which is left alone since it
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

export function extractPlayerNumber(text: string): string | null {
  const hashMatch = text.match(/#(\d+)/);
  if (hashMatch) return hashMatch[1];
  const stripped = text.replace(/\s*\([A-Z0-9]{1,4}\)\s*$/i, '').trimEnd();
  const tail = stripped.match(/([A-Za-z][A-Za-z'’.-]+)\s+#?(\d{1,2})$/);
  if (!tail) return null;
  const prev = tail[1].toLowerCase();
  if (['shirt', 'jersey', 'kit', 'size', 'version'].includes(prev)) return null;
  return tail[2];
}

export function extractPlayerNameFromTitle(text: string): string | null {
  const m = text.match(/((?:[A-Za-zÀ-ÿ]+\s+){0,3}[A-Za-zÀ-ÿ]+)\s*#\d+/);
  if (!m) return null;
  const cleaned = m[1]
    .trim()
    .replace(
      /\b(Shirt|Jersey|Kit|Top|Home|Away|Third|Fourth|Football|Long Sleeve|Short Sleeve|Authentic|Retail|Player Issue|Reissue|Special)\b/gi,
      '',
    )
    .trim();
  if (!cleaned || !/[A-Za-zÀ-ÿ]/.test(cleaned)) return null;
  return cleaned;
}

export function normalizePlayerName(team: string | null, player: string | null): string | null {
  if (!player) return null;
  const p = player.replace(/\s+/g, ' ').trim();
  if (!p) return null;
  if (/^(unknown|n\/?a|none|null|-)$/i.test(p)) return null;
  if (!/[A-Za-zÀ-ÿ]/.test(p)) return null;
  if (!team) return p;
  const t = team.replace(/\s+/g, ' ').trim();
  if (!t) return p;
  if (p.toLowerCase().startsWith(t.toLowerCase() + ' ')) return p.slice(t.length).trim() || null;
  const teamTokens = new Set(t.toLowerCase().split(/\s+/));
  const words = p.split(/\s+/);
  while (words.length > 1 && teamTokens.has(words[0].toLowerCase())) words.shift();
  return words.join(' ').trim() || null;
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

  const images = (input.images ?? []).filter((i): i is string => !!i && i.trim().length > 0);
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
    const r = extractSeasonSpan(haystack);
    season = r.season || null;
    extraSeasons = r.extraSeasons;
  }
  if (season) {
    confidence.season = 'certain';
  } else {
    reviewReasons.push('season could not be parsed, or the title mentions more than one distinct season/year');
  }

  // ---- Shirt type / jacket has no shirt_type ----
  let shirtType: string | null = null;
  if (!isJacket) {
    const explicitType = caseInsensitiveGet(extracted, 'type', 'shirtType', 'kitType');
    const r = detectShirtType(explicitType ?? haystack);
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
  const gender = canonicalGender(explicitGender && /\b(kids|women)/i.test(explicitGender) ? explicitGender : haystack);

  // ---- Issue / Special edition / Signed / Boxed (shirts only) ----
  let issue: string | null = null;
  let specialEdition: string | null = null;
  let signed: string | null = null;
  let boxed: string | null = null;
  if (!isJacket) {
    issue = canonicalIssue(caseInsensitiveGet(extracted, 'issue') ?? haystack);
    signed = canonicalSigned(caseInsensitiveGet(extracted, 'signed') ?? haystack);
  } else {
    signed = canonicalSigned(caseInsensitiveGet(extracted, 'signed') ?? haystack);
  }
  specialEdition = canonicalSpecialEdition(caseInsensitiveGet(extracted, 'specialEdition', 'edition') ?? haystack);
  boxed = canonicalBoxed(caseInsensitiveGet(extracted, 'boxedEdition', 'boxed') ?? haystack);

  // ---- Sleeves (shirts only) ----
  const sleeves = isJacket ? null : canonicalSleeves(caseInsensitiveGet(extracted, 'sleeves') ?? haystack);

  // ---- Player + number (shirts only) ----
  let player: string | null = null;
  let number: string | null = null;
  if (!isJacket) {
    const explicitPlayer = caseInsensitiveGet(extracted, 'player', 'playerName');
    const explicitNumber = caseInsensitiveGet(extracted, 'number', 'playerNumber', 'shirtNumber');
    let rawPlayer = explicitPlayer ?? extractPlayerNameFromTitle(title);
    rawPlayer = normalizePlayerName(team, rawPlayer);
    const manufacturerForStrip = caseInsensitiveGet(extracted, 'manufacturer', 'brand') ?? detectManufacturer(haystack);
    rawPlayer = stripManufacturerFromPlayer(rawPlayer, manufacturerForStrip);
    player = rawPlayer;
    number = sanitizeShirtNumber(explicitNumber ?? extractPlayerNumber(title));
  }

  // ---- Manufacturer ----
  const explicitManufacturer = caseInsensitiveGet(extracted, 'manufacturer', 'brand');
  let manufacturer: string | null = null;
  if (explicitManufacturer) {
    manufacturer = canonicalManufacturer(explicitManufacturer);
  } else {
    manufacturer = detectManufacturer(haystack);
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
    const detected = detectColours(haystack, 2);
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
    condition = gradeConditionText(haystack, hostname);
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
