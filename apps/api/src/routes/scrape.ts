import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { scrapePage } from '../lib/scrapeCore.js';
import { resolveSiteForUrl } from '../lib/siteResolver.js';
import { markUrlFetched } from '../lib/urlStore.js';
import { pool } from '../db.js';

const scrapeSchema = z.object({
  url: z.string().url(),
  formats: z.array(z.enum(['markdown', 'html', 'links', 'screenshot'])).optional(),
  onlyMainContent: z.boolean().optional(),
  waitFor: z.number().optional(),
  useBrowser: z.boolean().optional(),
  selectors: z.record(z.string()).optional(),
});

export async function scrapeRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/scrape', async (req, reply) => {
    const parsed = scrapeSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: parsed.error.message });
    }
    const body = parsed.data;

    const site = await resolveSiteForUrl(body.url);
    const result = await scrapePage(body.url, body, site);

    const { rawHtml, ...response } = result;

    if (site) {
      await markUrlFetched(site.id, body.url, result.metadata.statusCode, result.error).catch(
        () => undefined,
      );
      const { rows } = await pool.query('SELECT id FROM urls WHERE site_id = $1 AND url = $2', [
        site.id,
        body.url,
      ]);
      const urlId = rows[0]?.id;
      if (urlId) {
        const inserts: Promise<unknown>[] = [];
        if (result.markdown !== undefined) {
          inserts.push(
            pool.query(
              `INSERT INTO scrape_results (url_id, format, content, status_code) VALUES ($1, 'markdown', $2, $3)`,
              [urlId, JSON.stringify(result.markdown), result.metadata.statusCode],
            ),
          );
        }
        if (result.extracted !== undefined) {
          inserts.push(
            pool.query(
              `INSERT INTO scrape_results (url_id, format, content, status_code) VALUES ($1, 'extracted', $2, $3)`,
              [urlId, JSON.stringify(result.extracted), result.metadata.statusCode],
            ),
          );
        }
        await Promise.all(inserts).catch(() => undefined);
      }
    }

    return reply.send(response);
  });
}
