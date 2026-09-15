import type { FastifyInstance } from 'fastify';
import { pool } from '../../db.js';
import { requireAdminSession } from '../../middleware/adminAuth.js';
import { scrapePage } from '../../lib/scrapeCore.js';
import { markUrlFetched } from '../../lib/urlStore.js';
import { persistScrapeResult } from '../../lib/persistResult.js';

export async function adminUrlRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdminSession);

  app.get('/api/admin/sites/:siteId/urls', async (req, reply) => {
    const { siteId } = req.params as { siteId: string };
    const query = req.query as { status?: string; path?: string; page?: string; pageSize?: string };
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(Math.max(1, Number(query.pageSize) || 50), 200);
    const offset = (page - 1) * pageSize;

    const conditions = ['u.site_id = $1'];
    const params: unknown[] = [siteId];
    if (query.status) {
      params.push(query.status);
      conditions.push(`u.status = $${params.length}`);
    }
    if (query.path) {
      params.push(`%${query.path}%`);
      conditions.push(`u.path ILIKE $${params.length}`);
    }
    const where = conditions.join(' AND ');

    const { rows } = await pool.query(
      `SELECT u.*, m.content->>'title' AS preview_title, m.content->>'image' AS preview_image,
              e.content AS preview_extracted
       FROM urls u
       LEFT JOIN LATERAL (
         SELECT content FROM scrape_results sr
         WHERE sr.url_id = u.id AND sr.format = 'metadata'
         ORDER BY sr.fetched_at DESC LIMIT 1
       ) m ON true
       LEFT JOIN LATERAL (
         SELECT content FROM scrape_results sr
         WHERE sr.url_id = u.id AND sr.format = 'extracted'
         ORDER BY sr.fetched_at DESC LIMIT 1
       ) e ON true
       WHERE ${where} ORDER BY u.discovered_at DESC LIMIT ${pageSize} OFFSET ${offset}`,
      params,
    );
    const { rows: countRows } = await pool.query(
      `SELECT count(*) FROM urls u WHERE ${where}`,
      params,
    );

    return reply.send({ success: true, urls: rows, total: Number(countRows[0].count), page, pageSize });
  });

  app.post('/api/admin/urls/:id/rescrape', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { rows } = await pool.query(
      `SELECT u.*, s.* FROM urls u JOIN sites s ON s.id = u.site_id WHERE u.id = $1`,
      [id],
    );
    const row = rows[0];
    if (!row) return reply.code(404).send({ success: false, error: 'URL not found' });

    const result = await scrapePage(
      row.url,
      { formats: ['markdown', 'links'] },
      {
        id: row.site_id,
        name: row.name,
        base_url: row.base_url,
        rate_limit_rps: row.rate_limit_rps,
        max_depth: row.max_depth,
        use_browser_default: row.use_browser_default,
        use_proxy: row.use_proxy,
        default_selectors: row.default_selectors,
        allowed_paths: row.allowed_paths,
        denied_paths: row.denied_paths,
        is_active: row.is_active,
      },
    );

    const urlId = await markUrlFetched(row.site_id, row.url, result.metadata.statusCode, result.error);
    await persistScrapeResult(urlId, null, result);

    return reply.send({ success: result.success, result });
  });
}
