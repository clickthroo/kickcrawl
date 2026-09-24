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
