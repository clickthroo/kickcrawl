import type { FastifyInstance } from 'fastify';
import { pool } from '../../db.js';
import { requireAdminSession } from '../../middleware/adminAuth.js';
import { crawlQueue } from '../../queue.js';
import { createJob } from '../../lib/jobRecords.js';

export async function adminJobRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdminSession);

  app.get('/api/admin/jobs', async (req, reply) => {
    const { status, type } = req.query as { status?: string; type?: string };
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    if (type) {
      params.push(type);
      conditions.push(`type = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(
      `SELECT j.*, s.name AS site_name FROM jobs j LEFT JOIN sites s ON s.id = j.site_id
       ${where} ORDER BY j.created_at DESC LIMIT 200`,
      params,
    );
    return reply.send({ success: true, jobs: rows });
  });

  app.get('/api/admin/jobs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { rows } = await pool.query(
      'SELECT j.*, s.name AS site_name FROM jobs j LEFT JOIN sites s ON s.id = j.site_id WHERE j.id = $1',
      [id],
    );
    if (!rows[0]) return reply.code(404).send({ success: false, error: 'Job not found' });

    // One row per URL, pivoting the per-format scrape_results rows
    // (metadata/extracted/markdown) into a single human-friendly item.
    // jsonb has no MAX/MIN aggregate in Postgres, so this uses a LATERAL
    // join per format instead of conditional aggregation.
    const { rows: pages } = await pool.query(
      `SELECT
         u.url,
         u.last_status_code,
         u.last_error,
         latest.fetched_at,
         m.content ->> 'title' AS title,
         m.content ->> 'image' AS image,
         e.content AS extracted,
         md.content AS markdown
       FROM (SELECT DISTINCT url_id FROM scrape_results WHERE job_id = $1) du
       JOIN urls u ON u.id = du.url_id
       LEFT JOIN LATERAL (
         SELECT max(fetched_at) AS fetched_at FROM scrape_results sr
         WHERE sr.url_id = u.id AND sr.job_id = $1
       ) latest ON true
       LEFT JOIN LATERAL (
         SELECT content FROM scrape_results sr
         WHERE sr.url_id = u.id AND sr.job_id = $1 AND sr.format = 'metadata'
         ORDER BY sr.fetched_at DESC LIMIT 1
       ) m ON true
       LEFT JOIN LATERAL (
         SELECT content FROM scrape_results sr
         WHERE sr.url_id = u.id AND sr.job_id = $1 AND sr.format = 'extracted'
         ORDER BY sr.fetched_at DESC LIMIT 1
       ) e ON true
       LEFT JOIN LATERAL (
         SELECT content FROM scrape_results sr
         WHERE sr.url_id = u.id AND sr.job_id = $1 AND sr.format = 'markdown'
         ORDER BY sr.fetched_at DESC LIMIT 1
       ) md ON true
       ORDER BY latest.fetched_at DESC
       LIMIT 500`,
      [id],
    );

    return reply.send({ success: true, job: rows[0], pages });
  });

  app.post('/api/admin/jobs/:id/rerun', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { rows } = await pool.query('SELECT * FROM jobs WHERE id = $1', [id]);
    const job = rows[0];
    if (!job) return reply.code(404).send({ success: false, error: 'Job not found' });
    if (job.type !== 'crawl') {
      return reply.code(400).send({ success: false, error: 'Only crawl jobs can be re-run from here' });
    }

    const payload = job.payload;
    const newJobId = await createJob('crawl', job.site_id, payload, 'queued');
    await crawlQueue.add('crawl', {
      jobId: newJobId,
      siteId: job.site_id,
      url: payload.url,
      limit: payload.limit,
      maxDepth: payload.maxDepth,
      includePaths: payload.includePaths ?? [],
      excludePaths: payload.excludePaths ?? [],
      scrapeOptions: payload.scrapeOptions ?? {},
    });

    return reply.send({ success: true, jobId: newJobId });
  });
}
