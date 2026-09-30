import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from './config.js';

export const redisConnection = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null,
});

export interface CrawlJobData {
  jobId: string;
  siteId: string;
  url: string;
  limit: number;
  maxDepth: number;
  includePaths: string[];
  excludePaths: string[];
  scrapeOptions: {
    formats?: ('markdown' | 'html' | 'links' | 'screenshot')[];
    onlyMainContent?: boolean;
    useBrowser?: boolean;
  };
}

export const crawlQueue = new Queue<CrawlJobData>('crawl', { connection: redisConnection });

// A single global sweep (not per-site) - recheckWorker.ts loops every
// active site's already-fetched items itself, same as "Crawl all sites"
// loops sites, so there's nothing site-specific to put in the job data.
export const recheckQueue = new Queue('recheck', { connection: redisConnection });

// Same shape as recheckQueue - a single global sweep of every not-yet-
// synced row in the local sales table (workers/kickioSyncWorker.ts),
// nothing per-job to pass in.
export const kickioSyncQueue = new Queue('kickio_sync', { connection: redisConnection });

// A single global sweep of every opted-in site's active inventory
// (workers/kickioListingSyncWorker.ts) - list/refresh anything In Stock,
// delist anything that's since sold. Same "nothing per-job to pass in"
// shape as kickioSyncQueue above.
export const kickioListingSyncQueue = new Queue('kickio_listing_sync', { connection: redisConnection });

// A single global sweep (workers/crawlAllWorker.ts) that periodically
// re-queues a crawl for every active site, the same "Crawl all sites"
// button already does manually (lib/crawlAll.ts) - discovering NEW items
// only ever happens via a crawl, never via recheckQueue's own hourly
// sweep (which only revisits URLs already in the database), so without
// this, new listings only ever appear when an admin clicks the button
// themselves. Same "nothing per-job to pass in" shape as the other
// global sweeps above.
export const crawlAllScheduleQueue = new Queue('crawl_all_schedule', { connection: redisConnection });
