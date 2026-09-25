import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db.js';
import { crawlQueue } from '../queue.js';
import { getOrCreateSiteForUrl } from '../lib/siteResolver.js';
import { createJob } from '../lib/jobRecords.js';
import type { ApiKeyRequest } from '../middleware/apiAuth.js';

const crawlSchema = z.object({
  url: z.string().url(),
  limit: z.number().int().positive().max(10_000).optional().default(100),
  maxDepth: z.number().int().min(0).max(10).optional().default(2),
  includePaths: z.array(z.string()).optional().default([]),
  excludePaths: z.array(z.string()).optional().default([]),
  scrapeOptions: z
    .object({
      formats: z.array(z.enum(['markdown', 'html', 'links', 'screenshot'])).optional(),
      onlyMainContent: z.boolean().optional(),
      useBrowser: z.boolean().optional(),
    })
    .optional()
    .default({}),
});

export async function crawlRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/crawl', async (req, reply) => {
    const parsed = crawlSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: parsed.error.message });
    }
    const body = parsed.data;
    const site = await getOrCreateSiteForUrl(body.url);

    const jobId = await createJob('crawl', site.id, body, 'queued', (req as ApiKeyRequest).apiKeyId);
    await crawlQueue.add(
      'crawl',
      {
        jobId,
        siteId: site.id,
        url: body.url,
        limit: body.limit,
        maxDepth: body.maxDepth,
        includePaths: body.includePaths,
        excludePaths: body.excludePaths,
        scrapeOptions: body.scrapeOptions,
      },
      { jobId },
    );

    return reply.send({ success: true, jobId, status: 'queued' });
  });

  app.get('/api/v1/crawl/:jobId', async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    // Scoped to the calling key - a job created by a different key (or an
    // internal admin/worker job, which never has an api_key_id at all)
    // must 404 exactly like a nonexistent id, not reveal that it exists
    // under someone else's key.
    const { rows } = await pool.query('SELECT * FROM jobs WHERE id = $1 AND api_key_id = $2', [
      jobId,
      (req as ApiKeyRequest).apiKeyId,
    ]);
    const job = rows[0];
    if (!job) {
      return reply.code(404).send({ success: false, error: 'Job not found' });
    }

    const { rows: results } = await pool.query(
      `SELECT u.url, u.last_status_code, sr.content
       FROM urls u
       JOIN scrape_results sr ON sr.url_id = u.id
       WHERE sr.job_id = $1 AND sr.format = 'markdown'
       ORDER BY sr.fetched_at ASC`,
      [jobId],
    );

    const data = results.map((r) => ({
      markdown: r.content,
      metadata: { sourceURL: r.url, statusCode: r.last_status_code },
    }));

    return reply.send({
      success: true,
      status: job.status,
      completed: job.completed_pages,
      total: job.total_pages,
      data: job.status === 'completed' ? data : undefined,
      errors: job.errors,
    });
  });
}
