import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('processCrawlAll', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.doUnmock('../src/lib/crawlAll.js');
  });

  it('delegates to enqueueCrawlAllActiveSites and logs a summary', async () => {
    const enqueueCrawlAllActiveSites = vi.fn(async () => ({ jobIds: ['job-1'], total: 1, skipped: 2 }));
    vi.doMock('../src/lib/crawlAll.js', () => ({ enqueueCrawlAllActiveSites }));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const { processCrawlAll } = await import('../src/workers/crawlAllWorker.js');
    await processCrawlAll();

    expect(enqueueCrawlAllActiveSites).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('queued 1 crawl'));
  });
});

describe('scheduleCrawlAll', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('../src/queue.js');
  });

  it('removes any existing repeatable job before adding a fresh one, keyed by interval', async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const removeRepeatableByKey = vi.fn().mockResolvedValue(undefined);
    const getRepeatableJobs = vi.fn().mockResolvedValue([{ name: 'crawl_all_schedule', key: 'stale-key' }]);
    vi.doMock('../src/queue.js', () => ({
      redisConnection: {},
      crawlAllScheduleQueue: { add, getRepeatableJobs, removeRepeatableByKey },
    }));

    const { scheduleCrawlAll, CRAWL_ALL_INTERVAL_MS } = await import('../src/workers/crawlAllWorker.js');
    await scheduleCrawlAll();

    expect(removeRepeatableByKey).toHaveBeenCalledWith('stale-key');
    expect(add).toHaveBeenCalledWith('crawl_all_schedule', {}, { repeat: { every: CRAWL_ALL_INTERVAL_MS } });
    expect(CRAWL_ALL_INTERVAL_MS).toBe(24 * 60 * 60 * 1000);
  });
});
