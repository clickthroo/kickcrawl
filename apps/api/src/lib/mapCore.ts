import * as cheerio from 'cheerio';
import { getAllSitemapUrls } from '../services/sitemap.js';
import { fetchPage } from '../services/fetcher.js';
import { extractLinks, isSameSite } from '../services/links.js';
import { upsertDiscoveredUrls } from './urlStore.js';

export interface MapOptions {
  search?: string;
  limit?: number;
  includeSubdomains?: boolean;
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
 * found against the given site.
 */
export async function runMap(
  url: string,
  siteId: string,
  opts: MapOptions = {},
): Promise<string[]> {
  const { search, limit = 5000, includeSubdomains = false } = opts;
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
  urls = urls.slice(0, limit);

  await upsertDiscoveredUrls(siteId, urls);
  return urls;
}
