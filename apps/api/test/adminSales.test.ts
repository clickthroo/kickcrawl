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
        return { rows: [{ synced: '3', held: '2', stuck: '1', total: '6' }] };
      }
      if (sql.includes('count(*) FROM sales')) return { rows: [{ count: '6' }] };
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
    expect(body.kickioCounts).toEqual({ synced: 3, held: 2, stuck: 1, total: 6 });
    await app.close();
  });

  it('filters by kickio_status without changing the counts breakdown', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('count(*) FILTER')) {
        return { rows: [{ synced: '3', held: '2', stuck: '1', total: '6' }] };
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
    expect(body.kickioCounts.total).toBe(6);
    await app.close();
  });

  it('rejects an invalid kickio_status rather than building bad SQL from it', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('count(*) FILTER')) return { rows: [{ synced: '0', held: '0', stuck: '0', total: '0' }] };
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
