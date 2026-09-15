import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { runMap } from '../lib/mapCore.js';
import { getOrCreateSiteForUrl } from '../lib/siteResolver.js';

const mapSchema = z.object({
  url: z.string().url(),
  search: z.string().optional(),
  limit: z.number().int().positive().max(50_000).optional().default(5000),
  includeSubdomains: z.boolean().optional().default(false),
});

export async function mapRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/map', async (req, reply) => {
    const parsed = mapSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: parsed.error.message });
    }
    const { url, search, limit, includeSubdomains } = parsed.data;

    const site = await getOrCreateSiteForUrl(url);
    const urls = await runMap(url, site.id, { search, limit, includeSubdomains });

    return reply.send({ success: true, links: urls, total: urls.length });
  });
}
