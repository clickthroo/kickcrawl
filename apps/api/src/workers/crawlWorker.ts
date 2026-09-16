import { Worker, type Job } from 'bullmq';
import * as cheerio from 'cheerio';
import { redisConnection, type CrawlJobData } from '../queue.js';
import { pool } from '../db.js';
import { scrapePage, type ScrapeCoreResult } from '../lib/scrapeCore.js';
import { resolveSiteForUrl } from '../lib/siteResolver.js';
import { markUrlFetched, markUrlQueued, upsertDiscoveredUrls } from '../lib/urlStore.js';
import { persistScrapeResult } from '../lib/persistResult.js';
import { extractLinks, isPathAllowed, isSameSite, matchesPathPattern } from '../services/links.js';
import { config } from '../config.js';

/**
 * Which of a page's outbound same-site links the crawl should follow next.
 * denied_paths is a hard stop - dropped here so a denied page is never even
 * visited, not just never recorded. allowed_paths is deliberately NOT
 * applied here: a page outside it (e.g. a category/collection listing) is
 * often the only way to *reach* pages that are inside it (e.g. individual
 * product pages), so it still needs to be visited and have its own links
 * followed - see isCrawlItem() for the allow-list check that decides
 * whether a visited page gets recorded as an Item.
 */
export function filterTraversableLinks(
  links: string[],
  visited: Set<string>,
  excludePaths: string[],
): string[] {
  return links.filter((l) => !visited.has(l)).filter((l) => isPathAllowed(new URL(l).pathname, [], excludePaths));
}

/**
 * Whether a visited page counts as a real Item - gets its content
 * persisted and shown in the Items list - rather than just a stepping
 * stone the crawl passed through to discover further links. An empty
 * allowed_paths means everything visited (that isn't denied) is an item.
 */
export function isCrawlItem(path: string, includePaths: string[]): boolean {
  if (includePaths.length === 0) return true;
  return includePaths.some((p) => matchesPathPattern(path, p));
}

async function updateJobProgress(jobId: string, total: number, completed: number): Promise<void> {
  await pool.query(
    `UPDATE jobs SET status = 'running', total_pages = $2, completed_pages = $3 WHERE id = $1`,
    [jobId, total, completed],
  );
}

async function recordPageResult(
  siteId: string,
  jobId: string,
  url: string,
  result: ScrapeCoreResult,
): Promise<void> {
  const urlId = await markUrlFetched(siteId, url, result.metadata.statusCode, result.error);
  await persistScrapeResult(urlId, jobId, result);
}

// A catch-all safety net around the per-page fetch. Every individual I/O
// call inside scrapePage() (DNS, robots.txt, the HTTP fetch, the browser
// navigation) already has its own timeout, but that only helps if every
// future code path in there remembers to add one too - a single page
// hanging on some untimed corner (e.g. browser.newContext(),
// context.close()) would otherwise freeze the whole job forever, since
// the crawl loop is strictly sequential. 90s is generous enough to cover
// the slowest legitimate case (a near-max robots Crawl-delay plus a
// blocked-page browser retry) without masking a real hang for long.
export const PAGE_TIMEOUT_MS = 90_000;

export async function scrapePageWithTimeout(
  url: string,
  opts: Parameters<typeof scrapePage>[1],
  site: Parameters<typeof scrapePage>[2],
): Promise<ScrapeCoreResult> {
  return await Promise.race([
    scrapePage(url, opts, site),
    new Promise<ScrapeCoreResult>((resolve) =>
      setTimeout(
        () =>
          resolve({
            success: false,
            error: `Timed out after ${PAGE_TIMEOUT_MS}ms fetching this page`,
            metadata: { sourceURL: url, statusCode: 0 },
          }),
        PAGE_TIMEOUT_MS,
      ),
    ),
  ]);
}

async function fireWebhook(jobId: string, status: string): Promise<void> {
  if (!config.webhookUrl) return;
  try {
    await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, status, event: 'crawl.completed' }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // webhook delivery is best-effort
  }
}

async function processCrawl(job: Job<CrawlJobData>): Promise<void> {
  const { jobId, siteId, url, limit, maxDepth, includePaths, excludePaths, scrapeOptions } =
    job.data;
  const origin = new URL(url).origin;
  const site = await resolveSiteForUrl(url);

  const visited = new Set<string>();
  const queue: { url: string; depth: number }[] = [{ url: new URL(url).toString(), depth: 0 }];
  let completed = 0;
  const errors: string[] = [];

  await updateJobProgress(jobId, Math.min(limit, 1), 0);

  while (queue.length > 0 && visited.size < limit) {
    const next = queue.shift()!;
    if (visited.has(next.url)) continue;
    visited.add(next.url);

    // The seed (depth 0) is always an item, same as before. Anything else
    // is an item only if it matches allowed_paths - a page that doesn't
    // (e.g. a category/collection listing) still gets fetched below and
    // has its links followed, it just isn't recorded as an Item itself.
    const path = new URL(next.url).pathname;
    const isItem = next.depth === 0 || isCrawlItem(path, includePaths);

    if (isItem) await markUrlQueued(siteId, next.url);

    console.log(
      `[crawlWorker] job ${jobId} fetching ${next.url} (depth ${next.depth}, ${completed}/${limit} done, ${queue.length} queued)`,
    );
    const result = await scrapePageWithTimeout(
      next.url,
      { formats: scrapeOptions.formats ?? ['markdown'], onlyMainContent: scrapeOptions.onlyMainContent ?? true, useBrowser: scrapeOptions.useBrowser },
      site,
    );
    if (!result.success) {
      console.log(`[crawlWorker] job ${jobId} failed ${next.url}: ${result.error}`);
      if (isItem) {
        errors.push(`${next.url}: ${result.error}`);
        await recordPageResult(siteId, jobId, next.url, result);
      }
    } else {
      if (isItem) {
        await recordPageResult(siteId, jobId, next.url, result);
        completed += 1;
      }

      if (next.depth < maxDepth && result.rawHtml) {
        const $ = cheerio.load(result.rawHtml);
        const links = extractLinks($, next.url).filter((l) => isSameSite(l, origin, false));
        const newLinks = filterTraversableLinks(links, visited, excludePaths);
        // Only the links that will themselves be items get recorded into
        // the Items list - stepping-stone links (e.g. more category
        // pages) still get queued and traversed below, just not shown.
        const itemLinks = newLinks.filter((l) => isCrawlItem(new URL(l).pathname, includePaths));
        await upsertDiscoveredUrls(siteId, itemLinks);
        for (const link of newLinks) {
          queue.push({ url: link, depth: next.depth + 1 });
        }
      }
    }

    await updateJobProgress(jobId, Math.min(limit, visited.size + queue.length), completed);
  }

  await pool.query(
    `UPDATE jobs SET status = 'completed', total_pages = $2, completed_pages = $3,
       error_count = $4, errors = $5::jsonb, finished_at = now() WHERE id = $1`,
    [jobId, visited.size, completed, errors.length, JSON.stringify(errors.map((e) => ({ message: e })))],
  );

  await fireWebhook(jobId, 'completed');
}

export function startCrawlWorker(): Worker<CrawlJobData> {
  const worker = new Worker<CrawlJobData>(
    'crawl',
    async (job) => {
      try {
        await processCrawl(job);
      } catch (err) {
        await pool.query(
          `UPDATE jobs SET status = 'failed', error_count = error_count + 1,
             errors = errors || $2::jsonb, finished_at = now() WHERE id = $1`,
          [
            job.data.jobId,
            JSON.stringify([{ message: err instanceof Error ? err.message : String(err) }]),
          ],
        );
        throw err;
      }
    },
    { connection: redisConnection, concurrency: 3 },
  );
  worker.on('failed', (job, err) => {
    console.error(`[crawlWorker] job ${job?.id} failed:`, err);
  });
  return worker;
}
