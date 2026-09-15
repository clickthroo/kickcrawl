import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { scrapePage } from '../lib/scrapeCore.js';
import { resolveSiteForUrl } from '../lib/siteResolver.js';
import { markUrlFetched } from '../lib/urlStore.js';
import { persistScrapeResult } from '../lib/persistResult.js';

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
      try {
        const urlId = await markUrlFetched(
          site.id,
          body.url,
          result.metadata.statusCode,
          result.error,
        );
        await persistScrapeResult(urlId, null, result);
      } catch {
        // best-effort - persistence failures shouldn't fail the API response
      }
    }

    return reply.send(response);
  });
}
