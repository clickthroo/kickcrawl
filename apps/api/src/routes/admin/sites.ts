import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../../db.js';
import { requireAdminSession } from '../../middleware/adminAuth.js';
import { runMap } from '../../lib/mapCore.js';
import { crawlQueue } from '../../queue.js';
import { createJob } from '../../lib/jobRecords.js';

const siteSchema = z.object({
  name: z.string().min(1),
  base_url: z.string().url(),
  rate_limit_rps: z.number().positive().optional().default(1),
  max_depth: z.number().int().min(0).optional().default(2),
  use_browser_default: z.boolean().optional().default(false),
  use_proxy: z.boolean().optional().default(false),
  default_selectors: z.record(z.string()).optional().default({}),
  allowed_paths: z.array(z.string()).optional().default([]),
  denied_paths: z.array(z.string()).optional().default([]),
  is_active: z.boolean().optional().default(true),
});

interface SiteRow {
  id: string;
  base_url: string;
  max_depth: number;
  allowed_paths: string[] | null;
  denied_paths: string[] | null;
  use_browser_default: boolean;
}

// Repeatedly clicking "Run crawl"/"Crawl all sites" before an earlier
// crawl for the same site finishes used to queue a fresh duplicate every
// time. The per-domain rate limiter (services/rateLimiter.ts) is shared
// across all jobs hitting that domain, not per-job, so N concurrent
// crawls for the same site don't run N times faster - they just take
// turns sharing the same one-request-per-interval budget, making every
// one of them look stuck.
async function hasActiveCrawl(siteId: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM jobs WHERE site_id = $1 AND type = 'crawl' AND status IN ('queued', 'running') LIMIT 1`,
    [siteId],
  );
  return rows.length > 0;
}

function crawlPayloadForSite(site: SiteRow) {
  return {
    url: site.base_url,
    limit: 2000,
    maxDepth: site.max_depth,
    includePaths: site.allowed_paths ?? [],
    excludePaths: site.denied_paths ?? [],
    scrapeOptions: {
      formats: ['markdown', 'links'] as ('markdown' | 'links')[],
      onlyMainContent: true,
      useBrowser: site.use_browser_default,
    },
  };
}

export async function adminSiteRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdminSession);

  app.get('/api/admin/sites', async (_req, reply) => {
    const { rows } = await pool.query(`
      SELECT s.*,
        (SELECT count(*) FROM urls u WHERE u.site_id = s.id) AS url_count,
        (SELECT count(*) FROM urls u WHERE u.site_id = s.id AND u.status = 'fetched') AS fetched_count
      FROM sites s ORDER BY s.created_at DESC
    `);
    return reply.send({ success: true, sites: rows });
  });

  app.get('/api/admin/sites/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { rows } = await pool.query('SELECT * FROM sites WHERE id = $1', [id]);
    if (!rows[0]) return reply.code(404).send({ success: false, error: 'Site not found' });
    return reply.send({ success: true, site: rows[0] });
  });

  app.post('/api/admin/sites', async (req, reply) => {
    const parsed = siteSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.message });
    const s = parsed.data;
    try {
      const { rows } = await pool.query(
        `INSERT INTO sites (name, base_url, rate_limit_rps, max_depth, use_browser_default, use_proxy,
           default_selectors, allowed_paths, denied_paths, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          s.name,
          s.base_url,
          s.rate_limit_rps,
          s.max_depth,
          s.use_browser_default,
          s.use_proxy,
          JSON.stringify(s.default_selectors),
          s.allowed_paths,
          s.denied_paths,
          s.is_active,
        ],
      );
      return reply.send({ success: true, site: rows[0] });
    } catch (err) {
      return reply.code(409).send({ success: false, error: 'A site with that base URL already exists' });
    }
  });

  app.put('/api/admin/sites/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = siteSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.message });
    const s = parsed.data;

    const { rows } = await pool.query(
      `UPDATE sites SET
         name = COALESCE($2, name),
         base_url = COALESCE($3, base_url),
         rate_limit_rps = COALESCE($4, rate_limit_rps),
         max_depth = COALESCE($5, max_depth),
         use_browser_default = COALESCE($6, use_browser_default),
         use_proxy = COALESCE($7, use_proxy),
         default_selectors = COALESCE($8, default_selectors),
         allowed_paths = COALESCE($9, allowed_paths),
         denied_paths = COALESCE($10, denied_paths),
         is_active = COALESCE($11, is_active),
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [
        id,
        s.name,
        s.base_url,
        s.rate_limit_rps,
        s.max_depth,
        s.use_browser_default,
        s.use_proxy,
        s.default_selectors ? JSON.stringify(s.default_selectors) : null,
        s.allowed_paths,
        s.denied_paths,
        s.is_active,
      ],
    );
    if (!rows[0]) return reply.code(404).send({ success: false, error: 'Site not found' });
    return reply.send({ success: true, site: rows[0] });
  });

  app.delete('/api/admin/sites/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await pool.query('DELETE FROM sites WHERE id = $1', [id]);
    return reply.send({ success: true });
  });

  app.post('/api/admin/sites/:id/map', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { rows } = await pool.query('SELECT * FROM sites WHERE id = $1', [id]);
    const site = rows[0];
    if (!site) return reply.code(404).send({ success: false, error: 'Site not found' });

    try {
      const urls = await runMap(site.base_url, site.id, { limit: 5000 });
      return reply.send({ success: true, total: urls.length });
    } catch (err) {
      return reply
        .code(502)
        .send({ success: false, error: err instanceof Error ? err.message : 'Map run failed' });
    }
  });

  // Unlike "map" (which only discovers URLs), a crawl fetches each page's
  // content as it discovers it - queued as a background job so items show
  // up with titles/profiles already populated instead of needing a
  // one-by-one re-scrape afterwards.
  app.post('/api/admin/sites/:id/crawl', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { rows } = await pool.query('SELECT * FROM sites WHERE id = $1', [id]);
    const site = rows[0];
    if (!site) return reply.code(404).send({ success: false, error: 'Site not found' });

    if (await hasActiveCrawl(site.id)) {
      return reply.code(409).send({ success: false, error: 'A crawl is already queued or running for this site' });
    }

    const payload = crawlPayloadForSite(site);
    const jobId = await createJob('crawl', site.id, payload, 'queued');
    await crawlQueue.add('crawl', { jobId, siteId: site.id, ...payload }, { jobId });

    return reply.send({ success: true, jobId });
  });

  // Queues a crawl for every active site in one call. BullMQ's crawl worker
  // runs with concurrency 3 (see workers/crawlWorker.ts), so queuing many
  // sites at once is safe - they queue up and process a few at a time,
  // each still respecting its own per-site rate_limit_rps. Inactive sites
  // are skipped, matching the scoping already used for scraping elsewhere
  // (lib/siteResolver.ts).
  app.post('/api/admin/sites/crawl-all', async (_req, reply) => {
    const { rows } = await pool.query('SELECT * FROM sites WHERE is_active = true');

    const jobIds: string[] = [];
    let skipped = 0;
    for (const site of rows) {
      if (await hasActiveCrawl(site.id)) {
        skipped += 1;
        continue;
      }
      const payload = crawlPayloadForSite(site);
      const jobId = await createJob('crawl', site.id, payload, 'queued');
      await crawlQueue.add('crawl', { jobId, siteId: site.id, ...payload }, { jobId });
      jobIds.push(jobId);
    }

    return reply.send({ success: true, jobIds, total: jobIds.length, skipped });
  });
}
