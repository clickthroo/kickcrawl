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
