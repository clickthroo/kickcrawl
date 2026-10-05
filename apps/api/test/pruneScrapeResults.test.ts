import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('pruneScrapeResults', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.doUnmock('../src/db.js');
  });

  it('builds the keep-set once, deletes in batches until a short batch ends it, and always releases the client', async () => {
    const calls: string[] = [];
    const query = vi.fn(async (sql: string) => {
      calls.push(sql);
      if (sql.startsWith('DELETE FROM scrape_results')) {
        // First batch full (loop continues), second batch short (loop stops).
        const deleteCalls = calls.filter((s) => s.startsWith('DELETE FROM scrape_results')).length;
        return { rowCount: deleteCalls === 1 ? 5000 : 1342 };
      }
      return { rows: [] };
    });
    const release = vi.fn();
    const client = { query, release };
    const connect = vi.fn(async () => client);
    vi.doMock('../src/db.js', () => ({ pool: { connect } }));

    const { pruneScrapeResults } = await import('../src/lib/pruneScrapeResults.js');
    const progressUpdates: number[] = [];
    const total = await pruneScrapeResults(14, (deleted) => {
      progressUpdates.push(deleted);
    });

    expect(total).toBe(5000 + 1342);
    expect(progressUpdates).toEqual([5000, 6342]);

    // Keep-set built exactly once, before any delete.
    const keepSetIndex = calls.findIndex((s) => s.includes('CREATE TEMP TABLE scrape_results_keep'));
    expect(keepSetIndex).toBeGreaterThanOrEqual(0);
    const firstDeleteIndex = calls.findIndex((s) => s.startsWith('DELETE FROM scrape_results'));
    expect(keepSetIndex).toBeLessThan(firstDeleteIndex);
    expect(calls.filter((s) => s.includes('CREATE TEMP TABLE scrape_results_keep'))).toHaveLength(1);

    // Two delete batches, matching the full-then-short rowCounts above.
    expect(calls.filter((s) => s.startsWith('DELETE FROM scrape_results'))).toHaveLength(2);

    // Temp table cleaned up and the client released back to the pool.
    expect(calls.filter((s) => s.startsWith('DROP TABLE IF EXISTS scrape_results_keep'))).toHaveLength(2); // once defensively up front, once in the finally block
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('still releases the client when a delete fails partway through', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('DELETE FROM scrape_results')) throw new Error('connection reset');
      return { rows: [] };
    });
    const release = vi.fn();
    const connect = vi.fn(async () => ({ query, release }));
    vi.doMock('../src/db.js', () => ({ pool: { connect } }));

    const { pruneScrapeResults } = await import('../src/lib/pruneScrapeResults.js');
    await expect(pruneScrapeResults()).rejects.toThrow('connection reset');
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('defaults to the 14-day retention window', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('DELETE FROM scrape_results')) return { rowCount: 0 };
      return { rows: [] };
    });
    const connect = vi.fn(async () => ({ query, release: vi.fn() }));
    vi.doMock('../src/db.js', () => ({ pool: { connect } }));

    const { pruneScrapeResults, SCRAPE_RESULTS_RETENTION_DAYS } = await import('../src/lib/pruneScrapeResults.js');
    expect(SCRAPE_RESULTS_RETENTION_DAYS).toBe(14);

    await pruneScrapeResults();
    const deleteCall = query.mock.calls.find(([sql]) => (sql as string).startsWith('DELETE FROM scrape_results'));
    expect(deleteCall?.[1]).toEqual([14]);
  });
});
