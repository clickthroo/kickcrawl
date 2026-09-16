import { Worker, type Job } from 'bullmq';
import * as cheerio from 'cheerio';
import { redisConnection, type CrawlJobData } from '../queue.js';
import { pool } from '../db.js';
import { scrapePage, type ScrapeCoreResult } from '../lib/scrapeCore.js';
import { resolveSiteForUrl } from '../lib/siteResolver.js';
import { markUrlFetched, markUrlQueued, upsertDiscoveredUrls } from '../lib/urlStore.js';
import { persistScrapeResult } from '../lib/persistResult.js';
import { extractLinks, isPathAllowed, isSameSite } from '../services/links.js';
import { config } from '../config.js';

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

    // The seed URL (the site's own base_url, depth 0) always gets fetched
    // regardless of allowed/denied paths - those scope which *discovered*
    // links get followed, not whether the crawl can even start. Without
    // this, a site whose allowed_paths is scoped to product pages (e.g.
    // "/products/*", set for the Map/Items view) would filter out its own
    // homepage before ever fetching it, discover zero links, and the job
    // would "complete" having crawled nothing.
    const path = new URL(next.url).pathname;
    if (next.depth > 0 && !isPathAllowed(path, includePaths, excludePaths)) continue;

    await markUrlQueued(siteId, next.url);

    const result = await scrapePage(
      next.url,
      { formats: scrapeOptions.formats ?? ['markdown'], onlyMainContent: scrapeOptions.onlyMainContent ?? true, useBrowser: scrapeOptions.useBrowser },
      site,
    );

    if (!result.success) {
      errors.push(`${next.url}: ${result.error}`);
      await recordPageResult(siteId, jobId, next.url, result);
    } else {
      await recordPageResult(siteId, jobId, next.url, result);
      completed += 1;

      if (next.depth < maxDepth && result.rawHtml) {
        const $ = cheerio.load(result.rawHtml);
        const links = extractLinks($, next.url).filter((l) => isSameSite(l, origin, false));
        const newLinks = links.filter((l) => !visited.has(l));
        await upsertDiscoveredUrls(siteId, newLinks);
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
