import type { FastifyInstance } from 'fastify';
import { pool } from '../../db.js';
import { requireAdminSession } from '../../middleware/adminAuth.js';
import { crawlQueue } from '../../queue.js';

export async function adminStatsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdminSession);

  app.get('/api/admin/stats/dashboard', async (_req, reply) => {
    const [today, week, bySite, queueCounts] = await Promise.all([
      pool.query(
        `SELECT count(*) AS total,
           count(*) FILTER (WHERE last_status_code BETWEEN 200 AND 299) AS success,
           count(*) FILTER (WHERE status = 'failed') AS failed
         FROM urls WHERE last_fetched_at > now() - interval '1 day'`,
      ),
      pool.query(
        `SELECT count(*) AS total,
           count(*) FILTER (WHERE last_status_code BETWEEN 200 AND 299) AS success,
           count(*) FILTER (WHERE status = 'failed') AS failed
         FROM urls WHERE last_fetched_at > now() - interval '7 days'`,
      ),
      pool.query(
        `SELECT s.name, count(u.*) AS pages
         FROM urls u JOIN sites s ON s.id = u.site_id
         WHERE u.last_fetched_at > now() - interval '7 days'
         GROUP BY s.name ORDER BY pages DESC LIMIT 10`,
      ),
      crawlQueue.getJobCounts('waiting', 'active', 'delayed'),
    ]);

    return reply.send({
      success: true,
      today: today.rows[0],
      week: week.rows[0],
      topSites: bySite.rows,
      queueDepth:
        (queueCounts.waiting ?? 0) + (queueCounts.active ?? 0) + (queueCounts.delayed ?? 0),
    });
  });
}
