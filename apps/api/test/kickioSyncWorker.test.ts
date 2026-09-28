import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function mockCommon() {
  // createJob() (lib/jobRecords.js) does `INSERT INTO jobs ... RETURNING id`
  // and reads rows[0].id unconditionally - needs a real-shaped row back,
  // unlike every other query here which processKickioSync only inspects
  // the SQL/params of, never the result.
  const query = vi.fn(async (sql: string) => {
    if (String(sql).includes('INSERT INTO jobs')) return { rows: [{ id: 'test-job-id' }] };
    return { rows: [] };
  });
  vi.doMock('../src/db.js', () => ({ pool: { query } }));
  vi.doMock('../src/queue.js', () => ({
    redisConnection: {},
    kickioSyncQueue: { add: vi.fn() },
  }));
  return { query };
}

describe('processKickioSync', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('../src/db.js');
    vi.doUnmock('../src/queue.js');
    vi.doUnmock('../src/lib/kickioSync.js');
  });

  it('respects MAX_SYNC_ATTEMPTS by default - the normal hourly sweep never touches a stuck row', async () => {
    const { query } = mockCommon();
    vi.doMock('../src/lib/kickioSync.js', () => ({
      isKickioSyncConfigured: () => true,
      syncAndPersistOutcome: vi.fn(async () => ({ success: true })),
      MAX_SYNC_ATTEMPTS: 5,
    }));

    const { processKickioSync } = await import('../src/workers/kickioSyncWorker.js');
    await processKickioSync();

    const selectCall = query.mock.calls.find(([sql]) => String(sql).includes('FROM sales'));
    expect(selectCall).toBeDefined();
    expect(String(selectCall![0])).toContain('kickio_sync_attempts < $1');
    expect(selectCall![1]).toEqual([5]);
  });

  it('drops the attempts cap entirely when includeStuck is true - the admin recovery-sweep path', async () => {
    const { query } = mockCommon();
    vi.doMock('../src/lib/kickioSync.js', () => ({
      isKickioSyncConfigured: () => true,
      syncAndPersistOutcome: vi.fn(async () => ({ success: true })),
      MAX_SYNC_ATTEMPTS: 5,
    }));

    const { processKickioSync } = await import('../src/workers/kickioSyncWorker.js');
    await processKickioSync(true);

    const selectCall = query.mock.calls.find(([sql]) => String(sql).includes('FROM sales'));
    expect(selectCall).toBeDefined();
    expect(String(selectCall![0])).not.toContain('kickio_sync_attempts <');
    expect(selectCall![1]).toEqual([]);
  });

  it('still skips entirely when Kickio sync is not configured, regardless of includeStuck', async () => {
    const { query } = mockCommon();
    vi.doMock('../src/lib/kickioSync.js', () => ({
      isKickioSyncConfigured: () => false,
      syncAndPersistOutcome: vi.fn(),
      MAX_SYNC_ATTEMPTS: 5,
    }));

    const { processKickioSync } = await import('../src/workers/kickioSyncWorker.js');
    await processKickioSync(true);

    const selectCall = query.mock.calls.find(([sql]) => String(sql).includes('FROM sales'));
    expect(selectCall).toBeUndefined();
  });
});

describe('enqueueKickioSyncRecoverySweep', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('../src/queue.js');
  });

  it('queues a one-off job flagged includeStuck, distinct from the recurring hourly schedule', async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../src/queue.js', () => ({
      redisConnection: {},
      kickioSyncQueue: { add },
    }));

    const { enqueueKickioSyncRecoverySweep } = await import('../src/workers/kickioSyncWorker.js');
    await enqueueKickioSyncRecoverySweep();

    expect(add).toHaveBeenCalledWith('kickio_sync', { includeStuck: true });
  });
});
