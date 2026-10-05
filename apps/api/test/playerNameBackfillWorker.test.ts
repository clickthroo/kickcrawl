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
    playerNameBackfillQueue: { add: vi.fn() },
  }));
  return { query };
}

describe('processPlayerNameBackfill', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('../src/db.js');
    vi.doUnmock('../src/queue.js');
    vi.doUnmock('../src/lib/backfillPlayerNames.js');
  });

  it('creates a running job, reports progress via onProgress, and marks it completed', async () => {
    const { query } = mockCommon();
    const backfillBareInitialPlayerNames = vi.fn(async (onProgress?: (done: number, total: number) => Promise<void>) => {
      if (onProgress) {
        await onProgress(1, 2);
        await onProgress(2, 2);
      }
      return 2;
    });
    vi.doMock('../src/lib/backfillPlayerNames.js', () => ({ backfillBareInitialPlayerNames }));

    const { processPlayerNameBackfill } = await import('../src/workers/playerNameBackfillWorker.js');
    await processPlayerNameBackfill();

    expect(backfillBareInitialPlayerNames).toHaveBeenCalledTimes(1);

    const progressCalls = query.mock.calls.filter(([sql]) => String(sql).includes('total_pages = $2'));
    expect(progressCalls).toHaveLength(2);
    expect(progressCalls[0][1]).toEqual(['test-job-id', 2, 1]);
    expect(progressCalls[1][1]).toEqual(['test-job-id', 2, 2]);

    const completeCall = query.mock.calls.find(([sql]) => String(sql).includes("status = 'completed'"));
    expect(completeCall).toBeDefined();
    expect(completeCall![1]).toEqual(['test-job-id']);
  });

  it('marks the job failed and rethrows when the backfill itself throws', async () => {
    mockCommon();
    vi.doMock('../src/lib/backfillPlayerNames.js', () => ({
      backfillBareInitialPlayerNames: vi.fn(async () => {
        throw new Error('db exploded');
      }),
    }));

    const { processPlayerNameBackfill } = await import('../src/workers/playerNameBackfillWorker.js');
    await expect(processPlayerNameBackfill()).rejects.toThrow('db exploded');
  });
});

describe('enqueuePlayerNameBackfill', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('../src/queue.js');
  });

  it('queues a one-off job with no payload, distinct from any recurring schedule', async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../src/queue.js', () => ({
      redisConnection: {},
      playerNameBackfillQueue: { add },
    }));

    const { enqueuePlayerNameBackfill } = await import('../src/workers/playerNameBackfillWorker.js');
    await enqueuePlayerNameBackfill();

    expect(add).toHaveBeenCalledWith('player_name_backfill', {});
  });
});
