import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

describe('GET /api/admin/jobs', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.doUnmock('../src/db.js');
    vi.doUnmock('../src/middleware/adminAuth.js');
    vi.doUnmock('../src/queue.js');
    vi.doUnmock('../src/lib/jobRecords.js');
  });

  it('paginates instead of returning every matching job unbounded', async () => {
    // Previously this endpoint had no page/pageSize at all (just a flat
    // LIMIT 200), which Jobs.tsx then re-fetched in full on every 5-second
    // poll tick regardless of how many jobs existed.
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('count(*)')) return { rows: [{ count: '57' }] };
      return { rows: [{ id: 'job-1', site_name: 'Cult Kits' }] };
    });
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/middleware/adminAuth.js', () => ({ requireAdminSession: async () => undefined }));
    vi.doMock('../src/queue.js', () => ({ crawlQueue: { add: vi.fn() } }));

    const { adminJobRoutes } = await import('../src/routes/admin/jobs.js');
    const app = Fastify();
    await app.register(adminJobRoutes);

    const res = await app.inject({ method: 'GET', url: '/api/admin/jobs?page=2&pageSize=10' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.total).toBe(57);
    expect(body.page).toBe(2);
    expect(body.pageSize).toBe(10);
    const listCall = query.mock.calls.find(([sql]) => (sql as string).includes('FROM jobs j'));
    expect(listCall?.[0]).toContain('LIMIT 10 OFFSET 10');
    await app.close();
  });

  it('caps an oversized pageSize the same way every other admin list endpoint does', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('count(*)')) return { rows: [{ count: '0' }] };
      return { rows: [] };
    });
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/middleware/adminAuth.js', () => ({ requireAdminSession: async () => undefined }));
    vi.doMock('../src/queue.js', () => ({ crawlQueue: { add: vi.fn() } }));

    const { adminJobRoutes } = await import('../src/routes/admin/jobs.js');
    const app = Fastify();
    await app.register(adminJobRoutes);

    const res = await app.inject({ method: 'GET', url: '/api/admin/jobs?pageSize=5000' });
    const body = JSON.parse(res.body);

    expect(body.pageSize).toBe(200);
    await app.close();
  });
});
