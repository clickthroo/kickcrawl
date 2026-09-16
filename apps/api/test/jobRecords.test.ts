import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('recoverOrphanedJobs', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('marks every still-"running" job as failed and returns how many', async () => {
    // A fresh process starting up hasn't touched any job's status yet, so
    // a row still "running" at that point belongs to a previous process
    // instance that's gone (a crash, or a redeploy that killed it
    // mid-job) - without this sweep it would sit "Running" forever.
    const query = vi.fn(async () => ({ rowCount: 2 }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));

    const { recoverOrphanedJobs } = await import('../src/lib/jobRecords.js');
    const recovered = await recoverOrphanedJobs();

    expect(recovered).toBe(2);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/UPDATE jobs SET status = 'failed'/);
    expect(sql).toMatch(/WHERE status = 'running'/);
  });

  it('returns 0 when nothing was orphaned', async () => {
    const query = vi.fn(async () => ({ rowCount: 0 }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));

    const { recoverOrphanedJobs } = await import('../src/lib/jobRecords.js');
    expect(await recoverOrphanedJobs()).toBe(0);
  });
});

describe('deduplicateQueuedCrawls', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('removes older duplicate queued crawls from both Postgres and the BullMQ queue', async () => {
    // Failing the Postgres row alone isn't enough - the duplicate's
    // underlying BullMQ job is still sitting in Redis's queue and would
    // still get picked up and processed regardless of what the row says.
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT id FROM')) {
        return { rows: [{ id: 'old-job-1' }, { id: 'old-job-2' }] };
      }
      return { rowCount: 1 }; // failJob()'s own UPDATE
    });
    const remove = vi.fn(async () => undefined);
    const getJob = vi.fn(async () => ({ remove }));

    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/queue.js', () => ({ crawlQueue: { getJob } }));

    const { deduplicateQueuedCrawls } = await import('../src/lib/jobRecords.js');
    const removed = await deduplicateQueuedCrawls();

    expect(removed).toBe(2);
    expect(getJob).toHaveBeenCalledWith('old-job-1');
    expect(getJob).toHaveBeenCalledWith('old-job-2');
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it('still fails the Postgres row when its BullMQ job is already gone', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT id FROM')) return { rows: [{ id: 'ghost-job' }] };
      return { rowCount: 1 };
    });
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/queue.js', () => ({ crawlQueue: { getJob: vi.fn(async () => undefined) } }));

    const { deduplicateQueuedCrawls } = await import('../src/lib/jobRecords.js');
    await expect(deduplicateQueuedCrawls()).resolves.toBe(1);
  });

  it('returns 0 when there are no duplicates', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/queue.js', () => ({ crawlQueue: { getJob: vi.fn() } }));

    const { deduplicateQueuedCrawls } = await import('../src/lib/jobRecords.js');
    expect(await deduplicateQueuedCrawls()).toBe(0);
  });
});

describe('recoverStaleQueuedJobs', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('fails a queued row whose BullMQ job no longer exists, so it stops permanently blocking hasActiveCrawl()', async () => {
    // A "queued" row with a dead BullMQ counterpart can never actually
    // run - the worker will never pick it up - but hasActiveCrawl()
    // (routes/admin/sites.ts) still treats it as active, so "Run crawl"
    // falsely reports one already queued/running forever.
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT id FROM jobs')) return { rows: [{ id: 'ghost-job' }] };
      return { rowCount: 1 }; // failJob()'s own UPDATE
    });
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/queue.js', () => ({ crawlQueue: { getJob: vi.fn(async () => undefined) } }));

    const { recoverStaleQueuedJobs } = await import('../src/lib/jobRecords.js');
    const recovered = await recoverStaleQueuedJobs();

    expect(recovered).toBe(1);
    const failCall = query.mock.calls.find(([sql]) => sql.includes('UPDATE jobs SET status'));
    expect(failCall?.[1]).toEqual(['ghost-job', expect.any(String)]);
  });

  it('leaves a queued row alone when its BullMQ job still exists', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT id FROM jobs')) return { rows: [{ id: 'real-job' }] };
      return { rowCount: 1 };
    });
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/queue.js', () => ({ crawlQueue: { getJob: vi.fn(async () => ({ id: 'real-job' })) } }));

    const { recoverStaleQueuedJobs } = await import('../src/lib/jobRecords.js');
    expect(await recoverStaleQueuedJobs()).toBe(0);
  });

  it('returns 0 when there are no queued crawl jobs at all', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/queue.js', () => ({ crawlQueue: { getJob: vi.fn() } }));

    const { recoverStaleQueuedJobs } = await import('../src/lib/jobRecords.js');
    expect(await recoverStaleQueuedJobs()).toBe(0);
  });
});
