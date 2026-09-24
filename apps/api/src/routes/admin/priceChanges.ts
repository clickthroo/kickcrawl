import type { FastifyInstance } from 'fastify';
import { pool } from '../../db.js';
import { requireAdminSession } from '../../middleware/adminAuth.js';

export async function adminPriceChangeRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdminSession);

  app.get('/api/admin/price-changes', async (req, reply) => {
    const query = req.query as { site_id?: string; page?: string; pageSize?: string };
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(Math.max(1, Number(query.pageSize) || 25), 200);
    const offset = (page - 1) * pageSize;

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.site_id) {
      params.push(query.site_id);
      conditions.push(`pc.site_id = $${params.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT pc.*, s.name AS site_name, u.url
       FROM price_changes pc
       JOIN sites s ON s.id = pc.site_id
       JOIN urls u ON u.id = pc.url_id
       ${where}
       ORDER BY pc.detected_at DESC LIMIT ${pageSize} OFFSET ${offset}`,
      params,
    );
    const { rows: countRows } = await pool.query(`SELECT count(*) FROM price_changes pc ${where}`, params);

    return reply.send({ success: true, priceChanges: rows, total: Number(countRows[0].count), page, pageSize });
  });
}
