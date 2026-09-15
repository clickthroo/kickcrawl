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

function extractLocs(node: unknown): string[] {
  const locs: string[] = [];
  const arr = Array.isArray(node) ? node : node ? [node] : [];
  for (const entry of arr) {
    if (entry && typeof entry === 'object' && 'loc' in entry) {
      const loc = (entry as { loc: unknown }).loc;
      if (typeof loc === 'string') locs.push(loc);
    }
  }
  return locs;
}

/** Parses a sitemap (or sitemap index) URL and returns all page URLs found, recursing into nested sitemaps. */
export async function parseSitemap(url: string, seen = new Set<string>()): Promise<string[]> {
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
    return extractLocs(doc.urlset.url);
  }

  if (doc.sitemapindex) {
    const nestedUrls = extractLocs(doc.sitemapindex.sitemap);
    const results: string[] = [];
    for (const nested of nestedUrls) {
      const urls = await parseSitemap(nested, seen);
      results.push(...urls);
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

/** Returns every URL discoverable from a site's sitemap(s), or an empty array if none exist. */
export async function getAllSitemapUrls(origin: string): Promise<string[]> {
  const sitemapUrls = await discoverSitemapUrls(origin);
  const all = new Set<string>();
  for (const sitemapUrl of sitemapUrls) {
    const urls = await parseSitemap(sitemapUrl);
    urls.forEach((u) => all.add(u));
  }
  return [...all];
}
