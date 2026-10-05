import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function mockCommon() {
  // createJob() (lib/jobRecords.js) does `INSERT INTO jobs ... RETURNING id`
  // and reads rows[0].id unconditionally - needs a real-shaped row back,
  // every other query here is just inspected, never relied on for a value.
  const query = vi.fn(async (sql: string) => {
    if (String(sql).includes('INSERT INTO jobs')) return { rows: [{ id: 'test-job-id' }] };
    return { rows: [] };
  });
  vi.doMock('../src/db.js', () => ({ pool: { query } }));
  vi.doMock('../src/queue.js', () => ({
    redisConnection: {},
    scrapeResultsPruneQueue: { add: vi.fn() },
  }));
  return { query };
}

describe('processScrapeResultsPrune', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('../src/db.js');
    vi.doUnmock('../src/queue.js');
    vi.doUnmock('../src/lib/pruneScrapeResults.js');
  });

  it('creates a running job, reports progress via onProgress, and marks it completed', async () => {
    const { query } = mockCommon();
    const pruneScrapeResults = vi.fn(async (_days?: number, onProgress?: (deleted: number) => Promise<void>) => {
      if (onProgress) {
        await onProgress(5000);
        await onProgress(7342);
      }
      return 7342;
    });
    vi.doMock('../src/lib/pruneScrapeResults.js', () => ({ pruneScrapeResults }));

    const { processScrapeResultsPrune } = await import('../src/workers/scrapeResultsPruneWorker.js');
    await processScrapeResultsPrune();

    expect(pruneScrapeResults).toHaveBeenCalledTimes(1);

    const progressCalls = query.mock.calls.filter(([sql]) => String(sql).includes('completed_pages = $2'));
    expect(progressCalls).toHaveLength(2);
    expect(progressCalls[0][1]).toEqual(['test-job-id', 5000]);
    expect(progressCalls[1][1]).toEqual(['test-job-id', 7342]);

    const completeCall = query.mock.calls.find(([sql]) => String(sql).includes("status = 'completed'"));
    expect(completeCall).toBeDefined();
    expect(completeCall![1]).toEqual(['test-job-id']);
  });

  it('marks the job failed and rethrows when the prune itself throws', async () => {
    mockCommon();
    vi.doMock('../src/lib/pruneScrapeResults.js', () => ({
      pruneScrapeResults: vi.fn(async () => {
        throw new Error('db exploded');
      }),
    }));

    const { processScrapeResultsPrune } = await import('../src/workers/scrapeResultsPruneWorker.js');
    await expect(processScrapeResultsPrune()).rejects.toThrow('db exploded');
  });
});

describe('enqueueScrapeResultsPruneNow', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('../src/queue.js');
  });

  it('queues a one-off job with no payload, distinct from the daily schedule', async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../src/queue.js', () => ({
      redisConnection: {},
      scrapeResultsPruneQueue: { add },
    }));

    const { enqueueScrapeResultsPruneNow } = await import('../src/workers/scrapeResultsPruneWorker.js');
    await enqueueScrapeResultsPruneNow();

    expect(add).toHaveBeenCalledWith('scrape_results_prune', {});
  });
});

describe('scheduleScrapeResultsPrune', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('../src/queue.js');
  });

  it('removes any existing repeatable prune job before adding the current one, so redeploying never stacks a duplicate schedule', async () => {
    const removeRepeatableByKey = vi.fn().mockResolvedValue(undefined);
    const add = vi.fn().mockResolvedValue(undefined);
    const getRepeatableJobs = vi.fn().mockResolvedValue([
      { name: 'scrape_results_prune', key: 'old-key' },
      { name: 'some_other_job', key: 'unrelated-key' },
    ]);
    vi.doMock('../src/queue.js', () => ({
      redisConnection: {},
      scrapeResultsPruneQueue: { add, getRepeatableJobs, removeRepeatableByKey },
    }));

    const { scheduleScrapeResultsPrune } = await import('../src/workers/scrapeResultsPruneWorker.js');
    await scheduleScrapeResultsPrune();

    expect(removeRepeatableByKey).toHaveBeenCalledWith('old-key');
    expect(removeRepeatableByKey).not.toHaveBeenCalledWith('unrelated-key');
    expect(add).toHaveBeenCalledWith('scrape_results_prune', {}, { repeat: { every: 24 * 60 * 60 * 1000 } });
  });
});
