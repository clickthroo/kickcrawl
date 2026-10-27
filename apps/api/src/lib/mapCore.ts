import * as cheerio from 'cheerio';
import { getAllSitemapUrls } from '../services/sitemap.js';
import { fetchPage } from '../services/fetcher.js';
import { extractLinks, isPathAllowed, isSameSite } from '../services/links.js';
import { upsertDiscoveredUrls } from './urlStore.js';

export interface MapOptions {
  search?: string;
  limit?: number;
  includeSubdomains?: boolean;
  /**
   * Same allowed_paths/denied_paths a site's crawl already scopes its own
   * sitemap seeding to (workers/crawlWorker.ts's filterSitemapSeeds) -
   * applied here too, for the same reason: a Shopify sitemap index's
   * other sitemaps (collections, pages, blog posts) aren't item pages,
   * and Map persisting every one of them into the same `urls` table a
   * crawl's own item count is read from (routes/admin/sites.ts) silently
   * re-inflates it right back to the unscoped total even after a crawl
   * fix already scoped the crawl's OWN seeding and an admin has cleared
   * the table - confirmed in production on thesoccerarchive.com: a
   * Clear-items wipe followed by a fresh Map run alone put all ~13,900
   * sitemap URLs straight back into `urls`, undoing the crawl fix's
   * entire point without a single crawl ever running. Both default to
   * empty (keep today's "everything" behaviour) for a site with no
   * allowed_paths configured - same default filterSitemapSeeds itself
   * uses.
   */
  includePaths?: string[];
  excludePaths?: string[];
}

async function crawlForLinks(
  startUrl: string,
  origin: string,
  includeSubdomains: boolean,
  limit: number,
): Promise<Set<string>> {
  const found = new Set<string>([startUrl]);
  let frontier = [startUrl];

  for (let depth = 0; depth < 2 && frontier.length > 0 && found.size < limit; depth++) {
    const nextFrontier: string[] = [];
    for (const pageUrl of frontier) {
      if (found.size >= limit) break;
      const result = await fetchPage(pageUrl, { rateLimitRps: 2 });
      if (result.error || !result.html) continue;
      const $ = cheerio.load(result.html);
      const links = extractLinks($, result.finalUrl).filter((l) =>
        isSameSite(l, origin, includeSubdomains),
      );
      for (const link of links) {
        if (!found.has(link)) {
          found.add(link);
          nextFrontier.push(link);
        }
        if (found.size >= limit) break;
      }
    }
    frontier = nextFrontier;
  }
  return found;
}

/**
 * Maps every URL on a site: tries the sitemap first, falling back to a
 * depth-2 crawl of the homepage when no sitemap exists. Persists every URL
 * found against the given site - scoped to includePaths/excludePaths when
 * given, same as a crawl's own sitemap seeding (see MapOptions's own doc
 * comment for why this matters here specifically, not just for a crawl).
 */
export async function runMap(
  url: string,
  siteId: string,
  opts: MapOptions = {},
): Promise<string[]> {
  const { search, limit = 5000, includeSubdomains = false, includePaths = [], excludePaths = [] } = opts;
  const origin = new URL(url).origin;

  let urls = await getAllSitemapUrls(origin);
  if (urls.length === 0) {
    const crawled = await crawlForLinks(url, origin, includeSubdomains, limit);
    urls = [...crawled];
  }

  urls = urls.filter((u) => isSameSite(u, origin, includeSubdomains));
  if (search) {
    const needle = search.toLowerCase();
    urls = urls.filter((u) => u.toLowerCase().includes(needle));
  }
  if (includePaths.length > 0 || excludePaths.length > 0) {
    urls = urls.filter((u) => isPathAllowed(new URL(u).pathname, includePaths, excludePaths));
  }
  urls = urls.slice(0, limit);

  await upsertDiscoveredUrls(siteId, urls);
  return urls;
}
