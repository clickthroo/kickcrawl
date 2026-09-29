import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface MockRow {
  id: string;
  url: string;
  last_fetched_at?: string;
  preview_title?: string | null;
  preview_image?: string | null;
  preview_images?: string[] | null;
  preview_extracted?: Record<string, string> | null;
  preview_markdown?: string | null;
}

function mockCommon(opts: { toList?: MockRow[]; toDelist?: MockRow[] } = {}) {
  const toList = opts.toList ?? [];
  const toDelist = opts.toDelist ?? [];
  // createJob() (lib/jobRecords.js) does `INSERT INTO jobs ... RETURNING id`
  // and reads rows[0].id unconditionally - needs a real-shaped row back,
  // same as kickioSyncWorker.test.ts's own mockCommon. The two SELECTs are
  // told apart by which table they list first in the FROM clause - the
  // list-pass query starts `FROM urls u JOIN sites s`, the delist-pass
  // query is a plain `FROM urls u` with no join.
  const query = vi.fn(async (sql: string) => {
    const s = String(sql);
    if (s.includes('INSERT INTO jobs')) return { rows: [{ id: 'test-job-id' }] };
    if (s.includes('JOIN sites s')) return { rows: toList };
    if (s.includes('FROM urls u') && s.includes('kickio_delisted_at IS NULL')) return { rows: toDelist };
    return { rows: [] };
  });
  vi.doMock('../src/db.js', () => ({ pool: { query } }));
  vi.doMock('../src/queue.js', () => ({
    redisConnection: {},
    kickioListingSyncQueue: { add: vi.fn(), getRepeatableJobs: vi.fn().mockResolvedValue([]) },
  }));
  vi.doMock('../src/lib/currencyRates.js', () => ({ getCurrencyRates: vi.fn(async () => ({})) }));
  vi.doMock('../src/lib/kickioTeams.js', () => ({ getKickioTeamsForMatching: vi.fn(async () => null) }));
  vi.doMock('../src/services/kickioProfile.js', () => ({
    buildKickioProfile: vi.fn(() => ({ marker: 'built-profile' })),
  }));
  return { query };
}

describe('processKickioListingSync', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('../src/db.js');
    vi.doUnmock('../src/queue.js');
    vi.doUnmock('../src/lib/kickioSync.js');
    vi.doUnmock('../src/lib/kickioListingSync.js');
    vi.doUnmock('../src/lib/currencyRates.js');
    vi.doUnmock('../src/lib/kickioTeams.js');
    vi.doUnmock('../src/services/kickioProfile.js');
  });

  it('skips entirely when Kickio sync is not configured', async () => {
    const { query } = mockCommon();
    vi.doMock('../src/lib/kickioSync.js', () => ({ isKickioSyncConfigured: () => false }));
    vi.doMock('../src/lib/kickioListingSync.js', () => ({
      syncListingAndPersistOutcome: vi.fn(),
      delistAndPersistOutcome: vi.fn(),
      MAX_LISTING_SYNC_ATTEMPTS: 5,
    }));

    const { processKickioListingSync } = await import('../src/workers/kickioListingSyncWorker.js');
    await processKickioListingSync();

    const listSelect = query.mock.calls.find(([sql]) => String(sql).includes('JOIN sites s'));
    expect(listSelect).toBeUndefined();
  });

  it('scopes the list query to opted-in sites, In Stock items, not dismissed, gated by the attempts cap only pre-first-success', async () => {
    const { query } = mockCommon();
    vi.doMock('../src/lib/kickioSync.js', () => ({ isKickioSyncConfigured: () => true }));
    vi.doMock('../src/lib/kickioListingSync.js', () => ({
      syncListingAndPersistOutcome: vi.fn(async () => ({ success: true })),
      delistAndPersistOutcome: vi.fn(async () => ({ success: true })),
      MAX_LISTING_SYNC_ATTEMPTS: 5,
    }));

    const { processKickioListingSync } = await import('../src/workers/kickioListingSyncWorker.js');
    await processKickioListingSync();

    const listSelect = query.mock.calls.find(([sql]) => String(sql).includes('JOIN sites s'));
    expect(listSelect).toBeDefined();
    const sql = String(listSelect![0]);
    expect(sql).toContain('s.list_on_kickio = true');
    expect(sql).toContain("u.stock_status = 'In Stock'");
    expect(sql).toContain('u.kickio_listing_dismissed_at IS NULL');
    expect(sql).toContain('u.kickio_listing_synced_at IS NOT NULL OR u.kickio_listing_sync_attempts < $1');
    expect(listSelect![1]).toEqual([5]);
  });

  it('builds a profile and submits it for each row with scraped content, counting successes as listed', async () => {
    const row: MockRow = {
      id: 'url-1',
      url: 'https://example.com/item',
      preview_title: 'Man Utd Shirt',
      preview_extracted: { size: 'M' },
    };
    const { query } = mockCommon({ toList: [row] });
    vi.doMock('../src/lib/kickioSync.js', () => ({ isKickioSyncConfigured: () => true }));
    const syncListingAndPersistOutcome = vi.fn(async () => ({ success: true }));
    vi.doMock('../src/lib/kickioListingSync.js', () => ({
      syncListingAndPersistOutcome,
      delistAndPersistOutcome: vi.fn(async () => ({ success: true })),
      MAX_LISTING_SYNC_ATTEMPTS: 5,
    }));

    const { processKickioListingSync } = await import('../src/workers/kickioListingSyncWorker.js');
    await processKickioListingSync();

    expect(syncListingAndPersistOutcome).toHaveBeenCalledTimes(1);
    expect(syncListingAndPersistOutcome).toHaveBeenCalledWith('url-1', { marker: 'built-profile' });
    const finalUpdate = query.mock.calls.find(([sql]) => String(sql).includes(`status = 'completed'`));
    expect(finalUpdate).toBeDefined();
    expect(finalUpdate![1]).toEqual(['test-job-id', 1, 0, JSON.stringify([])]);
  });

  it('holds a row with nothing scraped yet without calling the sync function at all', async () => {
    const row: MockRow = { id: 'url-1', url: 'https://example.com/item' };
    await mockCommon({ toList: [row] });
    vi.doMock('../src/lib/kickioSync.js', () => ({ isKickioSyncConfigured: () => true }));
    const syncListingAndPersistOutcome = vi.fn(async () => ({ success: true }));
    vi.doMock('../src/lib/kickioListingSync.js', () => ({
      syncListingAndPersistOutcome,
      delistAndPersistOutcome: vi.fn(async () => ({ success: true })),
      MAX_LISTING_SYNC_ATTEMPTS: 5,
    }));

    const { processKickioListingSync } = await import('../src/workers/kickioListingSyncWorker.js');
    await processKickioListingSync();

    expect(syncListingAndPersistOutcome).not.toHaveBeenCalled();
  });

  it('delists every row that was synced and has since gone Out of Stock, regardless of the site opt-in', async () => {
    const row: MockRow = { id: 'url-2', url: 'https://example.com/sold-item' };
    const { query } = mockCommon({ toDelist: [row] });
    vi.doMock('../src/lib/kickioSync.js', () => ({ isKickioSyncConfigured: () => true }));
    const delistAndPersistOutcome = vi.fn(async () => ({ success: true }));
    vi.doMock('../src/lib/kickioListingSync.js', () => ({
      syncListingAndPersistOutcome: vi.fn(async () => ({ success: true })),
      delistAndPersistOutcome,
      MAX_LISTING_SYNC_ATTEMPTS: 5,
    }));

    const { processKickioListingSync } = await import('../src/workers/kickioListingSyncWorker.js');
    await processKickioListingSync();

    expect(delistAndPersistOutcome).toHaveBeenCalledWith('url-2', 'https://example.com/sold-item');
    const delistSelect = query.mock.calls.find(
      ([sql]) => String(sql).includes('FROM urls u') && String(sql).includes('kickio_delisted_at IS NULL'),
    );
    expect(String(delistSelect![0])).toContain("u.stock_status = 'Out of Stock'");
    expect(String(delistSelect![0])).not.toContain('list_on_kickio');
  });
});

describe('scheduleKickioListingSync', () => {
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
    const getRepeatableJobs = vi
      .fn()
      .mockResolvedValue([{ name: 'kickio_listing_sync', key: 'stale-key' }]);
    vi.doMock('../src/queue.js', () => ({
      redisConnection: {},
      kickioListingSyncQueue: { add, getRepeatableJobs, removeRepeatableByKey },
    }));

    const { scheduleKickioListingSync, KICKIO_LISTING_SYNC_INTERVAL_MS } = await import(
      '../src/workers/kickioListingSyncWorker.js'
    );
    await scheduleKickioListingSync();

    expect(removeRepeatableByKey).toHaveBeenCalledWith('stale-key');
    expect(add).toHaveBeenCalledWith(
      'kickio_listing_sync',
      {},
      { repeat: { every: KICKIO_LISTING_SYNC_INTERVAL_MS } },
    );
  });
});
