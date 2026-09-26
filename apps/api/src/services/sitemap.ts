import { XMLParser } from 'fast-xml-parser';
import { randomUserAgent } from './userAgents.js';
import { getSitemapUrls } from './robots.js';
import { safeFetch } from './urlSafety.js';

const parser = new XMLParser({ ignoreAttributes: false });
const MAX_NESTED_SITEMAPS = 50;

// Nested sitemap URLs come straight out of another site's XML, so they're
// attacker-influenced, not just the original caller-supplied URL - each one
// gets the same SSRF validation as any other fetch target.
async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await safeFetch(url, {
      headers: { 'User-Agent': randomUserAgent() },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export interface SitemapEntry {
  loc: string;
  /** The <lastmod> a site's own sitemap reported for this url, verbatim - null when the entry has none at all. */
  lastmod: string | null;
}

function extractEntries(node: unknown): SitemapEntry[] {
  const entries: SitemapEntry[] = [];
  const arr = Array.isArray(node) ? node : node ? [node] : [];
  for (const entry of arr) {
    if (entry && typeof entry === 'object' && 'loc' in entry) {
      const loc = (entry as { loc: unknown }).loc;
      if (typeof loc !== 'string') continue;
      const lastmod = (entry as { lastmod?: unknown }).lastmod;
      entries.push({ loc, lastmod: typeof lastmod === 'string' ? lastmod : null });
    }
  }
  return entries;
}

/** Parses a sitemap (or sitemap index) URL and returns every entry found, recursing into nested sitemaps. */
export async function parseSitemapEntries(url: string, seen = new Set<string>()): Promise<SitemapEntry[]> {
  if (seen.has(url) || seen.size >= MAX_NESTED_SITEMAPS) return [];
  seen.add(url);

  const xml = await fetchText(url);
  if (!xml) return [];

  let doc: any;
  try {
    doc = parser.parse(xml);
  } catch {
    return [];
  }

  if (doc.urlset) {
    return extractEntries(doc.urlset.url);
  }

  if (doc.sitemapindex) {
    const nested = extractEntries(doc.sitemapindex.sitemap);
    const results: SitemapEntry[] = [];
    for (const entry of nested) {
      const entries = await parseSitemapEntries(entry.loc, seen);
      results.push(...entries);
    }
    return results;
  }

  return [];
}

/** Finds sitemap URLs via robots.txt first, falling back to the conventional /sitemap.xml path. */
export async function discoverSitemapUrls(origin: string): Promise<string[]> {
  const fromRobots = await getSitemapUrls(origin);
  if (fromRobots.length > 0) return fromRobots;

  const conventional = `${origin}/sitemap.xml`;
  const text = await fetchText(conventional);
  return text ? [conventional] : [];
}

/** Every entry (url + lastmod) discoverable from a site's sitemap(s), deduplicated by url, or empty if none exist. */
export async function getAllSitemapEntries(origin: string): Promise<SitemapEntry[]> {
  const sitemapUrls = await discoverSitemapUrls(origin);
  const seenLocs = new Set<string>();
  const all: SitemapEntry[] = [];
  for (const sitemapUrl of sitemapUrls) {
    const entries = await parseSitemapEntries(sitemapUrl);
    for (const entry of entries) {
      if (!seenLocs.has(entry.loc)) {
        seenLocs.add(entry.loc);
        all.push(entry);
      }
    }
  }
  return all;
}

/** Returns every URL discoverable from a site's sitemap(s), or an empty array if none exist. */
export async function getAllSitemapUrls(origin: string): Promise<string[]> {
  const entries = await getAllSitemapEntries(origin);
  return entries.map((e) => e.loc);
}
