import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('recoverOrphanedJobs', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('marks every non-crawl job still "running" or "paused" as failed and returns how many', async () => {
    // A fresh process starting up hasn't touched any job's status yet, so
    // a row still "running" (or "paused" - its own in-process poll loop
    // died with the old process too) at that point belongs to a previous
    // process instance that's gone (a crash, or a redeploy that killed it
    // mid-job) - without this sweep it would sit stuck forever. Crawl jobs
    // are excluded here - they're resumed instead, see the test below.
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("type = 'crawl'")) return { rows: [] };
      return { rowCount: 2 };
    });
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/queue.js', () => ({ crawlQueue: { add: vi.fn() } }));

    const { recoverOrphanedJobs } = await import('../src/lib/jobRecords.js');
    const recovered = await recoverOrphanedJobs();

    expect(recovered).toBe(2);
    const failCall = query.mock.calls.find(([sql]) => sql.includes("UPDATE jobs SET status = 'failed'"));
    expect(failCall?.[0]).toMatch(/WHERE status IN \('running', 'paused'\) AND type != 'crawl'/);
  });

  it('returns 0 when nothing was orphaned', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("type = 'crawl'")) return { rows: [] };
      return { rowCount: 0 };
    });
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/queue.js', () => ({ crawlQueue: { add: vi.fn() } }));

    const { recoverOrphanedJobs } = await import('../src/lib/jobRecords.js');
    expect(await recoverOrphanedJobs()).toBe(0);
  });

  it('re-queues an orphaned crawl job to resume instead of failing it', async () => {
    // crawl_frontier (migration 012) now persists a crawl's own traversal
    // queue outside the process, so a 'running'/'paused' crawl row at boot
    // is resumable - re-enqueueing the same jobId with the original
    // CrawlJobData (reconstructed from the row's own `payload`) lets
    // processCrawl's resume logic pick the frontier back up, instead of
    // this sweep permanently failing it the way it still does for every
    // other job type.
    const payload = { url: 'https://example.com', limit: 100, maxDepth: 2, includePaths: [], excludePaths: [] };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("type = 'crawl'")) {
        return { rows: [{ id: 'job-1', site_id: 'site-1', payload }] };
      }
      if (sql.includes("SET status = 'queued'")) return { rowCount: 1 };
      return { rowCount: 0 }; // the non-crawl fail sweep
    });
    const add = vi.fn(async () => undefined);
    const getJob = vi.fn(async () => undefined);
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/queue.js', () => ({ crawlQueue: { add, getJob } }));

    const { recoverOrphanedJobs } = await import('../src/lib/jobRecords.js');
    expect(await recoverOrphanedJobs()).toBe(0);

    expect(query.mock.calls.some(([sql, params]) => sql.includes("SET status = 'queued'") && params?.[0] === 'job-1')).toBe(true);
    expect(add).toHaveBeenCalledWith('crawl', { jobId: 'job-1', siteId: 'site-1', ...payload }, { jobId: 'job-1' });
  });

  it('removes a stale BullMQ job of the same id before re-adding it, so a dead lock cannot swallow the resume', async () => {
    // Confirmed in production: crawlQueue.add() with an explicit jobId
    // that already exists in Redis (the previous process's own job,
    // stuck 'active' under a lock that will never be renewed since that
    // process is gone) is a no-op on the EXISTING job rather than a fresh
    // one - the Postgres row flips to 'queued' and this logs, but
    // processCrawl never actually starts running again until the stale
    // lock eventually expires on its own. Removing it first guarantees a
    // genuinely fresh, immediately runnable job every time.
    const payload = { url: 'https://example.com', limit: 100, maxDepth: 2, includePaths: [], excludePaths: [] };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("type = 'crawl'")) {
        return { rows: [{ id: 'job-1', site_id: 'site-1', payload }] };
      }
      return { rowCount: 0 };
    });
    const remove = vi.fn(async () => undefined);
    const getJob = vi.fn(async () => ({ remove }));
    const add = vi.fn(async () => undefined);
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/queue.js', () => ({ crawlQueue: { add, getJob } }));

    const { recoverOrphanedJobs } = await import('../src/lib/jobRecords.js');
    await recoverOrphanedJobs();

    expect(getJob).toHaveBeenCalledWith('job-1');
    expect(remove).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith('crawl', { jobId: 'job-1', siteId: 'site-1', ...payload }, { jobId: 'job-1' });
  });
});

describe('createJob', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('defaults api_key_id to null for an internal (admin/worker-triggered) job', async () => {
    const query = vi.fn(async () => ({ rows: [{ id: 'job-1' }] }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));

    const { createJob } = await import('../src/lib/jobRecords.js');
    const jobId = await createJob('recheck', null, {}, 'running');

    expect(jobId).toBe('job-1');
    const [, params] = query.mock.calls[0];
    expect(params).toEqual(['recheck', null, '{}', 'running', null]);
  });

  it('records the calling API key on a job created via the public v1 API - the job-ownership check (routes/crawl.ts) depends on this actually being set', async () => {
    const query = vi.fn(async () => ({ rows: [{ id: 'job-2' }] }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));

    const { createJob } = await import('../src/lib/jobRecords.js');
    await createJob('crawl', 'site-1', { url: 'https://example.com' }, 'queued', 'key-abc');

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('api_key_id');
    expect(params).toEqual(['crawl', 'site-1', '{"url":"https://example.com"}', 'queued', 'key-abc']);
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
    const payload = { url: 'https://example.com', limit: 100, maxDepth: 2, includePaths: [], excludePaths: [] };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT id, site_id, payload FROM jobs')) {
        return { rows: [{ id: 'ghost-job', site_id: 'site-1', payload }] };
      }
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

  it('leaves a queued row alone when its BullMQ job is still genuinely live', async () => {
    const payload = { url: 'https://example.com', limit: 100, maxDepth: 2, includePaths: [], excludePaths: [] };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT id, site_id, payload FROM jobs')) {
        return { rows: [{ id: 'real-job', site_id: 'site-1', payload }] };
      }
      return { rowCount: 1 };
    });
    const getJob = vi.fn(async () => ({ id: 'real-job', getState: async () => 'waiting' }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/queue.js', () => ({ crawlQueue: { getJob } }));

    const { recoverStaleQueuedJobs } = await import('../src/lib/jobRecords.js');
    expect(await recoverStaleQueuedJobs()).toBe(0);
  });

  it('resumes a queued row whose BullMQ job exists but is stuck terminally failed - add() would never revive it on its own', async () => {
    // Confirmed in production: a row can sit 'queued' pointing at a
    // BullMQ job that already finished (failed or completed) - add()
    // with that same jobId is a no-op on the dead job, not a fresh one,
    // so nothing will ever pick it up again without this.
    const payload = { url: 'https://example.com', limit: 100, maxDepth: 2, includePaths: [], excludePaths: [] };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT id, site_id, payload FROM jobs')) {
        return { rows: [{ id: 'stuck-job', site_id: 'site-1', payload }] };
      }
      if (sql.includes("SET status = 'queued'")) return { rowCount: 1 };
      return { rowCount: 0 };
    });
    const remove = vi.fn(async () => undefined);
    const getJob = vi.fn(async () => ({ id: 'stuck-job', getState: async () => 'failed', remove }));
    const add = vi.fn(async () => undefined);
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/queue.js', () => ({ crawlQueue: { getJob, add } }));

    const { recoverStaleQueuedJobs } = await import('../src/lib/jobRecords.js');
    expect(await recoverStaleQueuedJobs()).toBe(1);

    expect(remove).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith('crawl', { jobId: 'stuck-job', siteId: 'site-1', ...payload }, { jobId: 'stuck-job' });
  });

  it('returns 0 when there are no queued crawl jobs at all', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/queue.js', () => ({ crawlQueue: { getJob: vi.fn() } }));

    const { recoverStaleQueuedJobs } = await import('../src/lib/jobRecords.js');
    expect(await recoverStaleQueuedJobs()).toBe(0);
  });
});
