import { pool } from '../db.js';
import { crawlQueue } from '../queue.js';
import { createJob } from '../lib/jobRecords.js';

export interface CrawlSiteRow {
  id: string;
  base_url: string;
  max_depth: number;
  allowed_paths: string[] | null;
  denied_paths: string[] | null;
  use_browser_default: boolean;
}

// Repeatedly clicking "Run crawl"/"Crawl all sites" before an earlier
// crawl for the same site finishes used to queue a fresh duplicate every
// time. The per-domain rate limiter (services/rateLimiter.ts) is shared
// across all jobs hitting that domain, not per-job, so N concurrent
// crawls for the same site don't run N times faster - they just take
// turns sharing the same one-request-per-interval budget, making every
// one of them look stuck.
export async function hasActiveCrawl(siteId: string): Promise<boolean> {
  // 'paused' counts as active too - it's still occupying this site's one-
  // active-crawl slot, just not doing any fetching right now. Letting a
  // second crawl start while the first sits paused would defeat the whole
  // point of pausing instead of cancelling.
  const { rows } = await pool.query(
    `SELECT 1 FROM jobs WHERE site_id = $1 AND type = 'crawl' AND status IN ('queued', 'running', 'paused') LIMIT 1`,
    [siteId],
  );
  return rows.length > 0;
}

// A large site's real catalog can run well past a few thousand pages once
// category/nav pages are counted alongside actual items - 2000 was cutting
// a crawl off mid-catalog for a site that size well before it ever ran out
// of real links to follow. Exported so the admin "Run map" route
// (routes/admin/sites.ts) can share the same ceiling instead of a
// separately-tuned, easily-forgotten one of its own - confirmed on a real
// site (footballfinery.co.uk) whose sitemap alone exceeds the old, much
// lower map-only limit (5000), silently truncating discovery well short of
// its real catalog.
export const MAX_CRAWL_PAGES = 50_000;

export function crawlPayloadForSite(site: CrawlSiteRow) {
  return {
    url: site.base_url,
    limit: MAX_CRAWL_PAGES,
    maxDepth: site.max_depth,
    includePaths: site.allowed_paths ?? [],
    excludePaths: site.denied_paths ?? [],
    scrapeOptions: {
      formats: ['markdown', 'links'] as ('markdown' | 'links')[],
      onlyMainContent: true,
      useBrowser: site.use_browser_default,
    },
  };
}

export interface CrawlAllResult {
  jobIds: string[];
  total: number;
  skipped: number;
}

/**
 * Queues a crawl for every active site - the shared logic behind both the
 * admin "Crawl all sites" button (routes/admin/sites.ts) and the daily
 * scheduled sweep (workers/crawlAllWorker.ts), so a manual click and an
 * automatic tick behave identically (same skip-if-already-running guard,
 * same per-site payload). A site marked blocked_reason is already
 * is_active = false (migration 025), so it's excluded here the same way
 * any other inactive site is - never crawled automatically or via this
 * button, only ever by deliberately re-activating it first.
 */
export async function enqueueCrawlAllActiveSites(): Promise<CrawlAllResult> {
  const { rows } = await pool.query('SELECT * FROM sites WHERE is_active = true');

  const jobIds: string[] = [];
  let skipped = 0;
  for (const site of rows) {
    if (await hasActiveCrawl(site.id)) {
      skipped += 1;
      continue;
    }
    const payload = crawlPayloadForSite(site);
    const jobId = await createJob('crawl', site.id, payload, 'queued');
    await crawlQueue.add('crawl', { jobId, siteId: site.id, ...payload }, { jobId });
    jobIds.push(jobId);
  }

  return { jobIds, total: jobIds.length, skipped };
}
