import type { FastifyInstance } from 'fastify';
import { pool } from '../../db.js';
import { requireAdminSession } from '../../middleware/adminAuth.js';

export async function adminSalesRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdminSession);

  app.get('/api/admin/sales', async (req, reply) => {
    const query = req.query as { site_id?: string; page?: string; pageSize?: string };
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(Math.max(1, Number(query.pageSize) || 25), 200);
    const offset = (page - 1) * pageSize;

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.site_id) {
      params.push(query.site_id);
      conditions.push(`sa.site_id = $${params.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT sa.*, s.name AS site_name, u.url
       FROM sales sa
       JOIN sites s ON s.id = sa.site_id
       JOIN urls u ON u.id = sa.url_id
       ${where}
       ORDER BY sa.detected_at DESC LIMIT ${pageSize} OFFSET ${offset}`,
      params,
    );
    const { rows: countRows } = await pool.query(`SELECT count(*) FROM sales sa ${where}`, params);

    return reply.send({ success: true, sales: rows, total: Number(countRows[0].count), page, pageSize });
  });
}
