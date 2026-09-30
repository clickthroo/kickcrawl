import { Worker } from 'bullmq';
import { redisConnection, crawlAllScheduleQueue } from '../queue.js';
import { enqueueCrawlAllActiveSites } from '../lib/crawlAll.js';

export const CRAWL_ALL_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * The daily sweep that discovers NEW listings across every active site -
 * without this, the only thing that ever runs automatically is
 * recheckWorker.ts's hourly sweep, which only revisits URLs already in
 * the database (to catch sales/price changes), never a site's own
 * category/collection pages for items that weren't there before. Reuses
 * the exact same enqueue logic the admin "Crawl all sites" button already
 * calls (lib/crawlAll.ts), so a scheduled tick and a manual click behave
 * identically - same skip-if-already-running guard per site, same
 * per-site crawl payload.
 */
export async function processCrawlAll(): Promise<void> {
  const result = await enqueueCrawlAllActiveSites();
  console.log(
    `[crawlAllWorker] queued ${result.total} crawl(s), skipped ${result.skipped} site(s) with a crawl already in progress`,
  );
}

export function startCrawlAllWorker(): Worker {
  const worker = new Worker(
    'crawl_all_schedule',
    async () => {
      await processCrawlAll();
    },
    {
      connection: redisConnection,
      concurrency: 1,
      // Same rationale as every other single-instance scheduled worker in
      // this app (recheckWorker.ts, kickioSyncWorker.ts, ...) - no live
      // process to resume a stalled job, so fail it and let the next tick
      // start clean instead.
      maxStalledCount: 0,
      // This job itself is fast (it only enqueues 'crawl' jobs onto the
      // existing crawlQueue - crawlWorker.ts's own Worker does the actual
      // page-by-page fetching, entirely separately), so no need for the
      // generous browser-fetch lockDuration those other workers use.
    },
  );
  worker.on('failed', (job, err) => {
    console.error(`[crawlAllWorker] job ${job?.id} failed:`, err);
  });
  return worker;
}

/**
 * Registers the repeatable job - same dedup-by-removing-and-re-adding
 * pattern as recheckWorker.ts's own scheduleRecheck.
 */
export async function scheduleCrawlAll(): Promise<void> {
  const existing = await crawlAllScheduleQueue.getRepeatableJobs();
  for (const job of existing) {
    if (job.name === 'crawl_all_schedule') {
      await crawlAllScheduleQueue.removeRepeatableByKey(job.key);
    }
  }
  await crawlAllScheduleQueue.add('crawl_all_schedule', {}, { repeat: { every: CRAWL_ALL_INTERVAL_MS } });
}
