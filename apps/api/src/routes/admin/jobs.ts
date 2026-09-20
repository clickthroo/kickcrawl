import type { FastifyInstance } from 'fastify';
import { pool } from '../../db.js';
import { requireAdminSession } from '../../middleware/adminAuth.js';
import { crawlQueue } from '../../queue.js';
import { createJob } from '../../lib/jobRecords.js';
import { buildKickioProfile } from '../../services/kickioProfile.js';
import { getCurrencyRates } from '../../lib/currencyRates.js';
import { getKickioTeamsForMatching } from '../../lib/kickioTeams.js';

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
         m.content -> 'images' AS images,
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

    // Every scraped item also gets a read-only Kickio product profile -
    // team/season/type/condition/etc mapped per the shirt mapping guide -
    // so an admin can see how it would map without Kickcrawl ever writing
    // to Kickio's own database.
    const currencyRates = await getCurrencyRates();
    const kickioTeams = await getKickioTeamsForMatching();
    const pagesWithProfile = pages.map((p) => ({
      ...p,
      profile: buildKickioProfile({
        url: p.url,
        title: p.title,
        description: p.markdown?.slice(0, 4000) ?? null,
        // images is only absent for rows scraped before this field existed
        // - fall back to the single image they do have.
        images: p.images ?? [p.image],
        extracted: p.extracted,
        scrapedAt: p.fetched_at,
        currencyRates,
        kickioTeams,
      }),
    }));

    return reply.send({ success: true, job: rows[0], pages: pagesWithProfile });
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
    await crawlQueue.add(
      'crawl',
      {
        jobId: newJobId,
        siteId: job.site_id,
        url: payload.url,
        limit: payload.limit,
        maxDepth: payload.maxDepth,
        includePaths: payload.includePaths ?? [],
        excludePaths: payload.excludePaths ?? [],
        scrapeOptions: payload.scrapeOptions ?? {},
      },
      { jobId: newJobId },
    );

    return reply.send({ success: true, jobId: newJobId });
  });

  // Pause/resume/cancel are cooperative: they only flip the status column,
  // and it's the crawl worker's own loop (workers/crawlWorker.ts) that
  // notices the change and acts on it between page fetches, not an
  // immediate kill. A row already in a terminal state (or, for pause,
  // already paused) is left alone rather than silently no-oping, so the
  // admin UI can tell a stale click from a real state change.
  app.post('/api/admin/jobs/:id/pause', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { rows } = await pool.query(
      `UPDATE jobs SET status = 'paused' WHERE id = $1 AND status = 'running' RETURNING id`,
      [id],
    );
    if (!rows[0]) return reply.code(400).send({ success: false, error: 'Job is not running' });
    return reply.send({ success: true });
  });

  app.post('/api/admin/jobs/:id/resume', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { rows } = await pool.query(
      `UPDATE jobs SET status = 'running' WHERE id = $1 AND status = 'paused' RETURNING id`,
      [id],
    );
    if (!rows[0]) return reply.code(400).send({ success: false, error: 'Job is not paused' });
    return reply.send({ success: true });
  });

  app.post('/api/admin/jobs/:id/cancel', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { rows } = await pool.query(
      `UPDATE jobs SET status = 'cancelled', finished_at = now()
       WHERE id = $1 AND status IN ('queued', 'running', 'paused') RETURNING id`,
      [id],
    );
    if (!rows[0]) {
      return reply.code(400).send({ success: false, error: 'Job cannot be cancelled from its current state' });
    }
    return reply.send({ success: true });
  });
}
