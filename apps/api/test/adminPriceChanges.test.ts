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
    return { res, listSql: listCall?.[0] as string | undefined, listParams: listCall?.[1] as unknown[] | undefined };
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

  it('filters by category against the JSONB profile snapshot', async () => {
    const { res, listSql, listParams } = await inject('/api/admin/price-changes?category=Football+Shirts');
    expect(res.statusCode).toBe(200);
    expect(listSql).toContain(`pc.profile->>'category' ILIKE $1`);
    expect(listParams).toEqual(['%Football Shirts%']);
  });

  it('filters by team against the JSONB profile snapshot', async () => {
    const { listSql, listParams } = await inject('/api/admin/price-changes?team=Arsenal');
    expect(listSql).toContain(`pc.profile->'identity'->>'team' ILIKE $1`);
    expect(listParams).toEqual(['%Arsenal%']);
  });

  it('filters by type (shirt_type) against the JSONB profile snapshot', async () => {
    const { listSql, listParams } = await inject('/api/admin/price-changes?type=Home');
    expect(listSql).toContain(`pc.profile->'identity'->>'shirt_type' ILIKE $1`);
    expect(listParams).toEqual(['%Home%']);
  });

  it('filters by keyword across the title and listing description, using one shared parameter', async () => {
    const { listSql, listParams } = await inject('/api/admin/price-changes?keyword=retro');
    expect(listSql).toContain(`(pc.title ILIKE $1 OR pc.profile->'listing'->>'description' ILIKE $1)`);
    expect(listParams).toEqual(['%retro%']);
  });

  it('combines site_id with the profile filters, using positional params in order', async () => {
    const { listSql, listParams } = await inject(
      '/api/admin/price-changes?site_id=11111111-1111-1111-1111-111111111111&team=Arsenal&keyword=retro',
    );
    expect(listSql).toContain('pc.site_id = $1');
    expect(listSql).toContain(`pc.profile->'identity'->>'team' ILIKE $2`);
    expect(listSql).toContain(`pc.profile->'listing'->>'description' ILIKE $3`);
    expect(listParams).toEqual(['11111111-1111-1111-1111-111111111111', '%Arsenal%', '%retro%']);
  });
});
