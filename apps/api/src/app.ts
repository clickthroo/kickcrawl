import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { requireApiKey } from './middleware/apiAuth.js';
import { scrapeRoutes } from './routes/scrape.js';
import { mapRoutes } from './routes/map.js';
import { crawlRoutes } from './routes/crawl.js';
import { extractRoutes } from './routes/extract.js';
import { screenshotRoutes } from './routes/screenshot.js';
import { adminAuthRoutes } from './routes/admin/auth.js';
import { adminSiteRoutes } from './routes/admin/sites.js';
import { adminUrlRoutes } from './routes/admin/urls.js';
import { adminJobRoutes } from './routes/admin/jobs.js';
import { adminApiKeyRoutes } from './routes/admin/apiKeys.js';
import { adminSettingsRoutes } from './routes/admin/settings.js';
import { adminStatsRoutes } from './routes/admin/stats.js';
import { adminCurrencyRateRoutes } from './routes/admin/currencyRates.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: config.nodeEnv !== 'test' });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(cookie, { secret: config.sessionSecret });

  app.get('/health', async () => ({ ok: true }));

  app.addHook('preHandler', async (req, reply) => {
    if (req.url.startsWith('/api/v1/')) {
      await requireApiKey(req, reply);
    }
  });

  await app.register(scrapeRoutes);
  await app.register(mapRoutes);
  await app.register(crawlRoutes);
  await app.register(extractRoutes);
  await app.register(screenshotRoutes);

  await app.register(adminAuthRoutes);
  await app.register(adminSiteRoutes);
  await app.register(adminUrlRoutes);
  await app.register(adminJobRoutes);
  await app.register(adminApiKeyRoutes);
  await app.register(adminSettingsRoutes);
  await app.register(adminStatsRoutes);
  await app.register(adminCurrencyRateRoutes);

  // Serve the built admin UI (apps/admin/dist) as static files in production,
  // with a SPA fallback so client-side routes resolve on refresh.
  const adminDist = join(__dirname, '..', '..', 'admin', 'dist');
  if (existsSync(adminDist)) {
    await app.register(fastifyStatic, { root: adminDist });
    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.code(404).send({ success: false, error: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}
