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
