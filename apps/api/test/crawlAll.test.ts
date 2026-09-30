import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('hasActiveCrawl', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.doUnmock('../src/db.js');
  });

  it("treats 'queued', 'running', and 'paused' crawl jobs as active", async () => {
    const query = vi.fn(async () => ({ rows: [{ '?column?': 1 }] }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));

    const { hasActiveCrawl } = await import('../src/lib/crawlAll.js');
    const result = await hasActiveCrawl('site-1');

    expect(result).toBe(true);
    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toContain("status IN ('queued', 'running', 'paused')");
    expect(params).toEqual(['site-1']);
  });

  it('is false when no matching job row exists', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));

    const { hasActiveCrawl } = await import('../src/lib/crawlAll.js');
    expect(await hasActiveCrawl('site-1')).toBe(false);
  });
});

describe('crawlPayloadForSite', () => {
  it('builds the crawl payload from a site row, defaulting null allowed/denied paths to empty arrays', async () => {
    const { crawlPayloadForSite } = await import('../src/lib/crawlAll.js');
    const payload = crawlPayloadForSite({
      id: 'site-1',
      base_url: 'https://example.com',
      max_depth: 3,
      allowed_paths: null,
      denied_paths: null,
      use_browser_default: true,
    });

    expect(payload).toEqual({
      url: 'https://example.com',
      limit: 50_000,
      maxDepth: 3,
      includePaths: [],
      excludePaths: [],
      scrapeOptions: { formats: ['markdown', 'links'], onlyMainContent: true, useBrowser: true },
    });
  });
});

describe('enqueueCrawlAllActiveSites', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.doUnmock('../src/db.js');
    vi.doUnmock('../src/queue.js');
  });

  function siteRow(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'site-1',
      base_url: 'https://example.com',
      max_depth: 2,
      allowed_paths: [],
      denied_paths: [],
      use_browser_default: false,
      ...overrides,
    };
  }

  it('only ever selects active sites', async () => {
    const query = vi.fn(async (sql: string) => {
      if (String(sql).includes('FROM sites')) return { rows: [] };
      return { rows: [] };
    });
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/queue.js', () => ({ crawlQueue: { add: vi.fn() } }));

    const { enqueueCrawlAllActiveSites } = await import('../src/lib/crawlAll.js');
    await enqueueCrawlAllActiveSites();

    const sitesSelect = query.mock.calls.find(([sql]) => String(sql).includes('FROM sites'));
    expect(String(sitesSelect![0])).toContain('is_active = true');
  });

  it('queues a crawl job per active site and reports the total, skipping any site with an already-active crawl', async () => {
    const add = vi.fn();
    // site-1 has no active crawl (hasActiveCrawl's own SELECT returns no
    // rows); site-2 already has one queued (returns a row) - confirmed by
    // call order, since both sites' hasActiveCrawl checks share the same
    // "FROM jobs" query shape and only differ in which site.id was bound.
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      const s = String(sql);
      if (s.includes('FROM sites')) return { rows: [siteRow({ id: 'site-1' }), siteRow({ id: 'site-2' })] };
      if (s.includes('FROM jobs')) return { rows: params?.[0] === 'site-2' ? [{ '?column?': 1 }] : [] };
      if (s.includes('INSERT INTO jobs')) return { rows: [{ id: `job-for-${params?.[1]}` }] };
      return { rows: [] };
    });
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/queue.js', () => ({ crawlQueue: { add } }));

    const { enqueueCrawlAllActiveSites } = await import('../src/lib/crawlAll.js');
    const result = await enqueueCrawlAllActiveSites();

    expect(result.total).toBe(1);
    expect(result.skipped).toBe(1);
    expect(add).toHaveBeenCalledTimes(1);
    const [, jobData] = add.mock.calls[0];
    expect(jobData.siteId).toBe('site-1');
  });
});
