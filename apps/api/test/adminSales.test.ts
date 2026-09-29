import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

describe('GET /api/admin/sales', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.doUnmock('../src/db.js');
    vi.doUnmock('../src/middleware/adminAuth.js');
    vi.doUnmock('../src/lib/kickioSync.js');
  });

  it('includes each sale\'s computed kickio_status and a sync-status breakdown', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('count(*) FILTER')) {
        return { rows: [{ synced: '3', held: '2', stuck: '1', dismissed: '1', total: '7' }] };
      }
      if (sql.includes('count(*) FROM sales')) return { rows: [{ count: '7' }] };
      return { rows: [{ id: 'sale-1', kickio_status: 'held' }] };
    });
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/middleware/adminAuth.js', () => ({ requireAdminSession: async () => undefined }));

    const { adminSalesRoutes } = await import('../src/routes/admin/sales.js');
    const app = Fastify();
    await app.register(adminSalesRoutes);

    const res = await app.inject({ method: 'GET', url: '/api/admin/sales' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.sales[0].kickio_status).toBe('held');
    expect(body.kickioCounts).toEqual({ synced: 3, held: 2, stuck: 1, dismissed: 1, total: 7 });
    await app.close();
  });

  it('filters by kickio_status without changing the counts breakdown', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('count(*) FILTER')) {
        return { rows: [{ synced: '3', held: '2', stuck: '1', dismissed: '1', total: '7' }] };
      }
      if (sql.includes('count(*) FROM sales')) return { rows: [{ count: '1' }] };
      return { rows: [] };
    });
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/middleware/adminAuth.js', () => ({ requireAdminSession: async () => undefined }));

    const { adminSalesRoutes } = await import('../src/routes/admin/sales.js');
    const app = Fastify();
    await app.register(adminSalesRoutes);

    const res = await app.inject({ method: 'GET', url: '/api/admin/sales?kickio_status=stuck' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    // The count filter reached the list query...
    const listCall = query.mock.calls.find(([sql]) => (sql as string).includes('FROM sales sa\n'));
    expect(listCall?.[0]).toContain('kickio_sync_attempts >=');
    // ...but the breakdown itself still reflects the whole (unfiltered-by-status) set.
    expect(body.kickioCounts.stuck).toBe(1);
    expect(body.kickioCounts.total).toBe(7);
    await app.close();
  });

  it('filters by dismissed status, distinct from stuck/held', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('count(*) FILTER')) {
        return { rows: [{ synced: '3', held: '2', stuck: '1', dismissed: '1', total: '7' }] };
      }
      if (sql.includes('count(*) FROM sales')) return { rows: [{ count: '1' }] };
      return { rows: [{ id: 'sale-2', kickio_status: 'dismissed' }] };
    });
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/middleware/adminAuth.js', () => ({ requireAdminSession: async () => undefined }));

    const { adminSalesRoutes } = await import('../src/routes/admin/sales.js');
    const app = Fastify();
    await app.register(adminSalesRoutes);

    const res = await app.inject({ method: 'GET', url: '/api/admin/sales?kickio_status=dismissed' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.sales[0].kickio_status).toBe('dismissed');
    const listCall = query.mock.calls.find(([sql]) => (sql as string).includes('FROM sales sa\n'));
    expect(listCall?.[0]).toContain('kickio_sync_dismissed_at IS NOT NULL');
    await app.close();
  });

  it('rejects an invalid kickio_status rather than building bad SQL from it', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('count(*) FILTER')) {
        return { rows: [{ synced: '0', held: '0', stuck: '0', dismissed: '0', total: '0' }] };
      }
      if (sql.includes('count(*) FROM sales')) return { rows: [{ count: '0' }] };
      return { rows: [] };
    });
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/middleware/adminAuth.js', () => ({ requireAdminSession: async () => undefined }));

    const { adminSalesRoutes } = await import('../src/routes/admin/sales.js');
    const app = Fastify();
    await app.register(adminSalesRoutes);

    await app.inject({ method: 'GET', url: "/api/admin/sales?kickio_status='; DROP TABLE sales; --" });

    const listCall = query.mock.calls.find(([sql]) => (sql as string).includes('FROM sales sa\n'));
    expect(listCall?.[0]).not.toContain('DROP TABLE');
    await app.close();
  });
});

describe('POST /api/admin/sales/:id/retry-kickio-sync', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.doUnmock('../src/db.js');
    vi.doUnmock('../src/middleware/adminAuth.js');
    vi.doUnmock('../src/lib/kickioSync.js');
  });

  it('404s for an unknown sale', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/middleware/adminAuth.js', () => ({ requireAdminSession: async () => undefined }));

    const { adminSalesRoutes } = await import('../src/routes/admin/sales.js');
    const app = Fastify();
    await app.register(adminSalesRoutes);

    const res = await app.inject({ method: 'POST', url: '/api/admin/sales/missing/retry-kickio-sync' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('refuses to retry a sale that has already synced', async () => {
    const query = vi.fn(async () => ({ rows: [{ id: 'sale-1', kickio_synced_at: '2026-09-27T00:00:00Z' }] }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/middleware/adminAuth.js', () => ({ requireAdminSession: async () => undefined }));

    const { adminSalesRoutes } = await import('../src/routes/admin/sales.js');
    const app = Fastify();
    await app.register(adminSalesRoutes);

    const res = await app.inject({ method: 'POST', url: '/api/admin/sales/sale-1/retry-kickio-sync' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/already synced/i);
    await app.close();
  });

  it('answers 200 even when the retry itself is still held - that is routine, not a route failure', async () => {
    const query = vi.fn(async () => ({ rows: [{ id: 'sale-1', kickio_synced_at: null }] }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/middleware/adminAuth.js', () => ({ requireAdminSession: async () => undefined }));
    vi.doMock('../src/lib/kickioSync.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/lib/kickioSync.js')>();
      return {
        ...actual,
        syncAndPersistOutcome: vi.fn(async () => ({ success: false, error: 'no confident Kickio team match' })),
      };
    });

    const { adminSalesRoutes } = await import('../src/routes/admin/sales.js');
    const app = Fastify();
    await app.register(adminSalesRoutes);

    const res = await app.inject({ method: 'POST', url: '/api/admin/sales/sale-1/retry-kickio-sync' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.outcome.success).toBe(false);
    expect(body.outcome.error).toMatch(/no confident kickio team match/i);
    await app.close();
  });

  it('reports success with the outcome when the retry actually syncs', async () => {
    const query = vi.fn(async () => ({ rows: [{ id: 'sale-1', kickio_synced_at: null }] }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/middleware/adminAuth.js', () => ({ requireAdminSession: async () => undefined }));
    vi.doMock('../src/lib/kickioSync.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/lib/kickioSync.js')>();
      return {
        ...actual,
        syncAndPersistOutcome: vi.fn(async () => ({ success: true, productId: 'p1', saleId: 's1', action: 'insert' })),
      };
    });

    const { adminSalesRoutes } = await import('../src/routes/admin/sales.js');
    const app = Fastify();
    await app.register(adminSalesRoutes);

    const res = await app.inject({ method: 'POST', url: '/api/admin/sales/sale-1/retry-kickio-sync' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.outcome).toEqual({ success: true, productId: 'p1', saleId: 's1', action: 'insert' });
    await app.close();
  });

  it('refuses to retry a dismissed sale', async () => {
    const query = vi.fn(async () => ({
      rows: [{ id: 'sale-1', kickio_synced_at: null, kickio_sync_dismissed_at: '2026-09-28T00:00:00Z' }],
    }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/middleware/adminAuth.js', () => ({ requireAdminSession: async () => undefined }));

    const { adminSalesRoutes } = await import('../src/routes/admin/sales.js');
    const app = Fastify();
    await app.register(adminSalesRoutes);

    const res = await app.inject({ method: 'POST', url: '/api/admin/sales/sale-1/retry-kickio-sync' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/dismissed/i);
    await app.close();
  });
});

describe('POST /api/admin/sales/:id/force-resync-kickio', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.doUnmock('../src/db.js');
    vi.doUnmock('../src/middleware/adminAuth.js');
    vi.doUnmock('../src/lib/kickioSync.js');
    vi.doUnmock('../src/lib/scrapeCore.js');
    vi.doUnmock('../src/services/kickioProfile.js');
    vi.doUnmock('../src/lib/currencyRates.js');
    vi.doUnmock('../src/lib/kickioTeams.js');
  });

  const SYNCED_ROW = {
    id: 'sale-1',
    url_id: 'url-1',
    site_id: 'site-1',
    price: 51,
    currency: 'GBP',
    detected_at: '2026-09-27T00:00:00Z',
    kickio_synced_at: '2026-09-27T01:00:00Z',
    url: 'https://www.cultkits.com/products/2009-2010-machester-united-berbatov-9-home-shirt-s-nike',
    name: 'Cult Kits',
    base_url: 'https://www.cultkits.com',
    rate_limit_rps: 2,
    max_depth: 3,
    use_browser_default: true,
    skip_browser_for_items: false,
    use_proxy: false,
    default_selectors: {},
    allowed_paths: ['/products/*'],
    denied_paths: [],
    is_active: true,
    require_pro_seller: false,
    min_seller_feedback: null,
    currency_override: null,
  };

  it('404s for an unknown sale', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/middleware/adminAuth.js', () => ({ requireAdminSession: async () => undefined }));

    const { adminSalesRoutes } = await import('../src/routes/admin/sales.js');
    const app = Fastify();
    await app.register(adminSalesRoutes);

    const res = await app.inject({ method: 'POST', url: '/api/admin/sales/missing/force-resync-kickio' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('refuses a sale that has not synced yet - that is what Retry is for', async () => {
    const query = vi.fn(async () => ({ rows: [{ ...SYNCED_ROW, kickio_synced_at: null }] }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/middleware/adminAuth.js', () => ({ requireAdminSession: async () => undefined }));

    const { adminSalesRoutes } = await import('../src/routes/admin/sales.js');
    const app = Fastify();
    await app.register(adminSalesRoutes);

    const res = await app.inject({ method: 'POST', url: '/api/admin/sales/sale-1/force-resync-kickio' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/not synced yet/i);
    await app.close();
  });

  it('answers 502 with a clear reason when the source listing can no longer be re-fetched', async () => {
    const query = vi.fn(async () => ({ rows: [SYNCED_ROW] }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/middleware/adminAuth.js', () => ({ requireAdminSession: async () => undefined }));
    vi.doMock('../src/lib/scrapeCore.js', () => ({
      scrapePage: vi.fn(async () => ({ success: false, error: '404 Not Found', metadata: {} })),
    }));

    const { adminSalesRoutes } = await import('../src/routes/admin/sales.js');
    const app = Fastify();
    await app.register(adminSalesRoutes);

    const res = await app.inject({ method: 'POST', url: '/api/admin/sales/sale-1/force-resync-kickio' });
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error).toMatch(/could not re-fetch/i);
    await app.close();
  });

  it('rebuilds the profile from a fresh scrape, persists it, and resyncs even though the sale already synced', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM sales sa')) return { rows: [SYNCED_ROW] };
      return { rows: [] };
    });
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/middleware/adminAuth.js', () => ({ requireAdminSession: async () => undefined }));

    const scrapePage = vi.fn(async () => ({
      success: true,
      markdown: 'Manchester United shirt, Berbatov #9',
      metadata: { title: '2009/2010 Machester United Berbatov #9 Home Shirt (S) Nike', image: 'https://img/1.jpg' },
      extracted: { team: 'Manchester United' },
    }));
    vi.doMock('../src/lib/scrapeCore.js', () => ({ scrapePage }));

    const rebuiltProfile = { identity: { team: 'Manchester United', player: 'Berbatov', number: '9' } };
    const buildKickioProfile = vi.fn(() => rebuiltProfile);
    vi.doMock('../src/services/kickioProfile.js', () => ({ buildKickioProfile }));

    vi.doMock('../src/lib/currencyRates.js', () => ({ getCurrencyRates: vi.fn(async () => ({})) }));
    vi.doMock('../src/lib/kickioTeams.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/lib/kickioTeams.js')>();
      return { ...actual, getKickioTeamsForMatching: vi.fn(async () => null) };
    });

    const syncAndPersistOutcome = vi.fn(async () => ({ success: true, productId: 'p1', saleId: 's1', action: 'update' }));
    vi.doMock('../src/lib/kickioSync.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/lib/kickioSync.js')>();
      return { ...actual, syncAndPersistOutcome };
    });

    const { adminSalesRoutes } = await import('../src/routes/admin/sales.js');
    const app = Fastify();
    await app.register(adminSalesRoutes);

    const res = await app.inject({ method: 'POST', url: '/api/admin/sales/sale-1/force-resync-kickio' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.outcome).toEqual({ success: true, productId: 'p1', saleId: 's1', action: 'update' });

    // Scraped the sale's own source URL, not something else.
    expect(scrapePage).toHaveBeenCalledWith(SYNCED_ROW.url, expect.any(Object), expect.any(Object));

    // Persisted the newly rebuilt profile - not the stale one.
    const updateCall = query.mock.calls.find(([sql]) => (sql as string).includes('UPDATE sales SET profile'));
    expect(JSON.parse(updateCall![1][1])).toEqual(rebuiltProfile);

    // Resynced using the freshly rebuilt profile, keyed by the sale's own
    // id/url_id/price/currency/detected_at - despite already being synced.
    expect(syncAndPersistOutcome).toHaveBeenCalledWith({
      id: 'sale-1',
      url_id: 'url-1',
      price: 51,
      currency: 'GBP',
      detected_at: '2026-09-27T00:00:00Z',
      profile: rebuiltProfile,
    });
    await app.close();
  });
});

describe('POST /api/admin/sales/:id/dismiss-kickio-sync', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.doUnmock('../src/db.js');
    vi.doUnmock('../src/middleware/adminAuth.js');
  });

  it('404s for an unknown sale', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/middleware/adminAuth.js', () => ({ requireAdminSession: async () => undefined }));

    const { adminSalesRoutes } = await import('../src/routes/admin/sales.js');
    const app = Fastify();
    await app.register(adminSalesRoutes);

    const res = await app.inject({ method: 'POST', url: '/api/admin/sales/missing/dismiss-kickio-sync' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('refuses to dismiss a sale that has already synced', async () => {
    const query = vi.fn(async () => ({ rows: [{ kickio_synced_at: '2026-09-27T00:00:00Z' }] }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/middleware/adminAuth.js', () => ({ requireAdminSession: async () => undefined }));

    const { adminSalesRoutes } = await import('../src/routes/admin/sales.js');
    const app = Fastify();
    await app.register(adminSalesRoutes);

    const res = await app.inject({ method: 'POST', url: '/api/admin/sales/sale-1/dismiss-kickio-sync' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/already synced/i);
    await app.close();
  });

  it('marks the sale dismissed', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT kickio_synced_at')) return { rows: [{ kickio_synced_at: null }] };
      return { rows: [] };
    });
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/middleware/adminAuth.js', () => ({ requireAdminSession: async () => undefined }));

    const { adminSalesRoutes } = await import('../src/routes/admin/sales.js');
    const app = Fastify();
    await app.register(adminSalesRoutes);

    const res = await app.inject({ method: 'POST', url: '/api/admin/sales/sale-1/dismiss-kickio-sync' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ success: true });

    const updateCall = query.mock.calls.find(([sql]) => (sql as string).includes('kickio_sync_dismissed_at = now()'));
    expect(updateCall?.[1]).toEqual(['sale-1']);
    await app.close();
  });
});

describe('POST /api/admin/sales/:id/undismiss-kickio-sync', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.doUnmock('../src/db.js');
    vi.doUnmock('../src/middleware/adminAuth.js');
  });

  it('404s for an unknown sale', async () => {
    const query = vi.fn(async () => ({ rowCount: 0 }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/middleware/adminAuth.js', () => ({ requireAdminSession: async () => undefined }));

    const { adminSalesRoutes } = await import('../src/routes/admin/sales.js');
    const app = Fastify();
    await app.register(adminSalesRoutes);

    const res = await app.inject({ method: 'POST', url: '/api/admin/sales/missing/undismiss-kickio-sync' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('clears the dismissal', async () => {
    const query = vi.fn(async () => ({ rowCount: 1 }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/middleware/adminAuth.js', () => ({ requireAdminSession: async () => undefined }));

    const { adminSalesRoutes } = await import('../src/routes/admin/sales.js');
    const app = Fastify();
    await app.register(adminSalesRoutes);

    const res = await app.inject({ method: 'POST', url: '/api/admin/sales/sale-1/undismiss-kickio-sync' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ success: true });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('kickio_sync_dismissed_at = NULL'), ['sale-1']);
    await app.close();
  });
});

describe('POST /api/admin/sales/retry-all-kickio-sync', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.doUnmock('../src/middleware/adminAuth.js');
    vi.doUnmock('../src/workers/kickioSyncWorker.js');
  });

  it('queues the recovery sweep and answers immediately, without waiting for it to finish', async () => {
    vi.doMock('../src/middleware/adminAuth.js', () => ({ requireAdminSession: async () => undefined }));
    const enqueueKickioSyncRecoverySweep = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../src/workers/kickioSyncWorker.js', () => ({ enqueueKickioSyncRecoverySweep }));

    const { adminSalesRoutes } = await import('../src/routes/admin/sales.js');
    const app = Fastify();
    await app.register(adminSalesRoutes);

    const res = await app.inject({ method: 'POST', url: '/api/admin/sales/retry-all-kickio-sync' });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ success: true });
    expect(enqueueKickioSyncRecoverySweep).toHaveBeenCalledTimes(1);
    await app.close();
  });
});

describe('POST /api/admin/sales/:id/set-team', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.doUnmock('../src/db.js');
    vi.doUnmock('../src/middleware/adminAuth.js');
    vi.doUnmock('../src/lib/kickioSync.js');
    vi.doUnmock('../src/lib/kickioTeams.js');
  });

  const TEAMS = [{ name: 'Manchester City', slug: 'manchester-city', country: 'England' }];

  it('rejects a missing/blank team', async () => {
    vi.doMock('../src/db.js', () => ({ pool: { query: vi.fn() } }));
    vi.doMock('../src/middleware/adminAuth.js', () => ({ requireAdminSession: async () => undefined }));

    const { adminSalesRoutes } = await import('../src/routes/admin/sales.js');
    const app = Fastify();
    await app.register(adminSalesRoutes);

    const res = await app.inject({ method: 'POST', url: '/api/admin/sales/sale-1/set-team', payload: { team: '  ' } });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/team name is required/i);
    await app.close();
  });

  it('404s for an unknown sale', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/middleware/adminAuth.js', () => ({ requireAdminSession: async () => undefined }));

    const { adminSalesRoutes } = await import('../src/routes/admin/sales.js');
    const app = Fastify();
    await app.register(adminSalesRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/sales/missing/set-team',
      payload: { team: 'Manchester City' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('refuses a sale that has already synced', async () => {
    const query = vi.fn(async () => ({ rows: [{ id: 'sale-1', kickio_synced_at: '2026-09-27T00:00:00Z' }] }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/middleware/adminAuth.js', () => ({ requireAdminSession: async () => undefined }));

    const { adminSalesRoutes } = await import('../src/routes/admin/sales.js');
    const app = Fastify();
    await app.register(adminSalesRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/sales/sale-1/set-team',
      payload: { team: 'Manchester City' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/already synced/i);
    await app.close();
  });

  it('refuses to set a team on a dismissed sale', async () => {
    const query = vi.fn(async () => ({
      rows: [{ id: 'sale-1', kickio_synced_at: null, kickio_sync_dismissed_at: '2026-09-28T00:00:00Z' }],
    }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/middleware/adminAuth.js', () => ({ requireAdminSession: async () => undefined }));

    const { adminSalesRoutes } = await import('../src/routes/admin/sales.js');
    const app = Fastify();
    await app.register(adminSalesRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/sales/sale-1/set-team',
      payload: { team: 'Manchester City' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/dismissed/i);
    await app.close();
  });

  it('refuses a sale with no stored profile at all', async () => {
    const query = vi.fn(async () => ({ rows: [{ id: 'sale-1', kickio_synced_at: null, profile: null }] }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/middleware/adminAuth.js', () => ({ requireAdminSession: async () => undefined }));

    const { adminSalesRoutes } = await import('../src/routes/admin/sales.js');
    const app = Fastify();
    await app.register(adminSalesRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/sales/sale-1/set-team',
      payload: { team: 'Manchester City' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/no stored profile/i);
    await app.close();
  });

  it('rejects a team name that is not a real Kickio team, rather than writing it through as a guess', async () => {
    const query = vi.fn(async () => ({
      rows: [{ id: 'sale-1', kickio_synced_at: null, profile: { identity: { team_kickio_match: null } } }],
    }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/middleware/adminAuth.js', () => ({ requireAdminSession: async () => undefined }));
    vi.doMock('../src/lib/kickioTeams.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/lib/kickioTeams.js')>();
      return { ...actual, getKickioTeams: vi.fn(async () => ({ teams: TEAMS, fetchedAt: Date.now(), stale: false })) };
    });

    const { adminSalesRoutes } = await import('../src/routes/admin/sales.js');
    const app = Fastify();
    await app.register(adminSalesRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/sales/sale-1/set-team',
      payload: { team: 'Not A Real Team' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/not a recognised kickio team/i);
    // Never even reaches the UPDATE - only the initial SELECT ran.
    expect(query).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('answers 501 when Kickio team matching is not configured in this deployment', async () => {
    const query = vi.fn(async () => ({
      rows: [{ id: 'sale-1', kickio_synced_at: null, profile: { identity: { team_kickio_match: null } } }],
    }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/middleware/adminAuth.js', () => ({ requireAdminSession: async () => undefined }));
    vi.doMock('../src/lib/kickioTeams.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/lib/kickioTeams.js')>();
      return {
        ...actual,
        getKickioTeams: vi.fn(async () => {
          throw new actual.KickioTeamsNotConfiguredError();
        }),
      };
    });

    const { adminSalesRoutes } = await import('../src/routes/admin/sales.js');
    const app = Fastify();
    await app.register(adminSalesRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/sales/sale-1/set-team',
      payload: { team: 'Manchester City' },
    });
    expect(res.statusCode).toBe(501);
    await app.close();
  });

  it('accepts a case-insensitive match, persists the canonical name, and immediately attempts a sync', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT id, url_id')) {
        return {
          rows: [
            {
              id: 'sale-1',
              url_id: 'url-1',
              price: 10,
              currency: 'GBP',
              detected_at: '2026-09-27T00:00:00Z',
              kickio_synced_at: null,
              profile: { identity: { team_kickio_match: null } },
            },
          ],
        };
      }
      return { rows: [] };
    });
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/middleware/adminAuth.js', () => ({ requireAdminSession: async () => undefined }));
    vi.doMock('../src/lib/kickioTeams.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/lib/kickioTeams.js')>();
      return { ...actual, getKickioTeams: vi.fn(async () => ({ teams: TEAMS, fetchedAt: Date.now(), stale: false })) };
    });
    const syncAndPersistOutcome = vi.fn(async () => ({ success: true, productId: 'p1', saleId: 's1', action: 'insert' }));
    vi.doMock('../src/lib/kickioSync.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/lib/kickioSync.js')>();
      return { ...actual, syncAndPersistOutcome };
    });

    const { adminSalesRoutes } = await import('../src/routes/admin/sales.js');
    const app = Fastify();
    await app.register(adminSalesRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/sales/sale-1/set-team',
      payload: { team: 'manchester city' },
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.outcome).toEqual({ success: true, productId: 'p1', saleId: 's1', action: 'insert' });

    const updateCall = query.mock.calls.find(([sql]) => (sql as string).includes('UPDATE sales SET profile'));
    expect(updateCall).toBeTruthy();
    const persistedProfile = JSON.parse(updateCall![1][1]);
    expect(persistedProfile.identity.team_kickio_match).toBe('Manchester City');

    expect(syncAndPersistOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sale-1', profile: expect.objectContaining({ identity: expect.objectContaining({ team_kickio_match: 'Manchester City' }) }) }),
    );
    await app.close();
  });
});
