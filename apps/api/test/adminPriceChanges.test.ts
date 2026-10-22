import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

describe('GET /api/admin/price-changes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.doUnmock('../src/db.js');
    vi.doUnmock('../src/middleware/adminAuth.js');
  });

  async function inject(url: string) {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('count(*)')) return { rows: [{ count: '0' }] };
      return { rows: [] };
    });
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/middleware/adminAuth.js', () => ({ requireAdminSession: async () => undefined }));

    const { adminPriceChangeRoutes } = await import('../src/routes/admin/priceChanges.js');
    const app = Fastify();
    await app.register(adminPriceChangeRoutes);

    const res = await app.inject({ method: 'GET', url });
    const listCall = query.mock.calls.find(([sql]) => (sql as string).includes('ORDER BY'));
    await app.close();
    return { res, listSql: listCall?.[0] as string | undefined };
  }

  it('defaults to sorting by most recent, same as before this feature existed', async () => {
    const { res, listSql } = await inject('/api/admin/price-changes');
    expect(res.statusCode).toBe(200);
    expect(listSql).toContain('ORDER BY pc.detected_at DESC');
  });

  it('sorts by biggest percentage drop when asked, ranking a rise last rather than excluding it', async () => {
    const { listSql } = await inject('/api/admin/price-changes?sort=drop_pct');
    expect(listSql).toContain(
      'ORDER BY (pc.new_price - pc.old_price) / NULLIF(pc.old_price, 0) ASC, pc.detected_at DESC',
    );
  });

  it('sorts by biggest absolute (£) drop when asked', async () => {
    const { listSql } = await inject('/api/admin/price-changes?sort=drop_abs');
    expect(listSql).toContain('ORDER BY (pc.new_price - pc.old_price) ASC, pc.detected_at DESC');
  });

  it('falls back to the default sort for an unrecognised value, rather than erroring or injecting it into the query', async () => {
    const { res, listSql } = await inject('/api/admin/price-changes?sort=DROP TABLE price_changes');
    expect(res.statusCode).toBe(200);
    expect(listSql).toContain('ORDER BY pc.detected_at DESC');
  });
});
