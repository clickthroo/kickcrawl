import type { FastifyInstance } from 'fastify';
import { pool } from '../../db.js';
import { requireAdminSession } from '../../middleware/adminAuth.js';

// Allowlisted ORDER BY clauses, keyed by the sort the admin UI offers -
// never interpolate the ?sort= query param directly into SQL. "recent"
// matches this route's original (and only) behaviour. The two "drop"
// sorts rank every price change by its signed change (negative = a drop,
// positive = a rise), not just drops in isolation, so a rise still shows
// up - just ranked after every real drop, biggest first. NULLIF guards
// the percentage sort against a division by zero on the (constraint-
// allowed but real-world-impossible) old_price = 0 case; detected_at DESC
// breaks ties the same way the default sort already orders everything.
const SORTS: Record<string, string> = {
  recent: 'pc.detected_at DESC',
  drop_pct: '(pc.new_price - pc.old_price) / NULLIF(pc.old_price, 0) ASC, pc.detected_at DESC',
  drop_abs: '(pc.new_price - pc.old_price) ASC, pc.detected_at DESC',
};

// price_changes.profile is a JSONB snapshot of the full KickioProfile at
// detection time (see services/kickioProfile.ts) - unlike urls'
// profileFilterConditions (routes/admin/urls.ts), which filters real
// flattened columns, there's no persisted column to match against here, so
// these go straight at the JSONB paths. category is a top-level string;
// team and shirt_type ("type") live under identity. keyword searches the
// listing's own title/description text, not the structured fields, since
// it's meant as a free-text catch-all.
function priceChangeFilterConditions(
  query: { category?: string; team?: string; type?: string; keyword?: string },
  params: unknown[],
): string[] {
  const conditions: string[] = [];
  const ilike = (value: string) => {
    params.push(`%${value}%`);
    return `$${params.length}`;
  };
  if (query.category) conditions.push(`pc.profile->>'category' ILIKE ${ilike(query.category)}`);
  if (query.team) conditions.push(`pc.profile->'identity'->>'team' ILIKE ${ilike(query.team)}`);
  if (query.type) conditions.push(`pc.profile->'identity'->>'shirt_type' ILIKE ${ilike(query.type)}`);
  if (query.keyword) {
    const p = ilike(query.keyword);
    conditions.push(`(pc.title ILIKE ${p} OR pc.profile->'listing'->>'description' ILIKE ${p})`);
  }
  return conditions;
}

export async function adminPriceChangeRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdminSession);

  app.get('/api/admin/price-changes', async (req, reply) => {
    const query = req.query as {
      site_id?: string;
      page?: string;
      pageSize?: string;
      sort?: string;
      category?: string;
      team?: string;
      type?: string;
      keyword?: string;
    };
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(Math.max(1, Number(query.pageSize) || 25), 200);
    const offset = (page - 1) * pageSize;
    const orderBy = SORTS[query.sort ?? ''] ?? SORTS.recent;

    const params: unknown[] = [];
    const conditions: string[] = [];
    if (query.site_id) {
      params.push(query.site_id);
      conditions.push(`pc.site_id = $${params.length}`);
    }
    conditions.push(...priceChangeFilterConditions(query, params));
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT pc.*, s.name AS site_name, u.url
       FROM price_changes pc
       JOIN sites s ON s.id = pc.site_id
       JOIN urls u ON u.id = pc.url_id
       ${where}
       ORDER BY ${orderBy} LIMIT ${pageSize} OFFSET ${offset}`,
      params,
    );
    const { rows: countRows } = await pool.query(`SELECT count(*) FROM price_changes pc ${where}`, params);

    return reply.send({ success: true, priceChanges: rows, total: Number(countRows[0].count), page, pageSize });
  });
}
