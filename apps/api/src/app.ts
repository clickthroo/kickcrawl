import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { requireApiKey } from './middleware/apiAuth.js';
import { hashApiKey } from './lib/apiKeys.js';
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
import { adminSalesRoutes } from './routes/admin/sales.js';
import { adminPriceChangeRoutes } from './routes/admin/priceChanges.js';
import { adminKickioTeamRoutes } from './routes/admin/kickioTeams.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: config.nodeEnv !== 'test' });

  await app.register(cookie, { secret: config.sessionSecret });

  app.get('/health', async () => ({ ok: true }));

  // Public v1 API only - API-key authenticated (Authorization: Bearer),
  // never cookie-based, so it's safe for this to allow being called
  // cross-origin from any site integrating against it: CORS here can
  // never expose an admin's session, since these routes never read the
  // session cookie at all. Registered on a dedicated child scope (not the
  // top-level `app`) so neither this CORS policy nor the rate limiter
  // below leak onto the admin routes registered further down - Fastify
  // hooks registered on a child context never apply to siblings.
  //
  // credentials:true + origin:true used to be registered globally here,
  // which - combined with the admin routes' cookie-based session below -
  // meant ANY website could ride a logged-in admin's session cross-origin
  // and read/act on admin data. Confirmed as a real, live gap in an app
  // audit, not theoretical. Scoping CORS to only the key-authenticated
  // routes (which need no `credentials` mode at all - a Bearer token in a
  // header isn't restricted by it) closes that off; the admin UI is
  // served from this same origin (see the static-file block below), so
  // the browser's ordinary same-origin policy is all admin routes need.
  await app.register(async (v1) => {
    await v1.register(cors, { origin: true, credentials: false });
    // Per-API-key, not per-IP: a rate-limit keyed on IP alone would let
    // every caller behind a shared NAT/office IP throttle each other, and
    // would let a single abusive key just rotate source IPs to dodge the
    // limit entirely. Hashed the same way requireApiKey looks a key up
    // (lib/apiKeys.ts) - registered as its own preHandler ahead of
    // requireApiKey's own preHandler below, so a request with no/invalid
    // key still gets rate-limited (falling back to its IP) rather than
    // bypassing this check entirely by never reaching auth.
    await v1.register(rateLimit, {
      max: 100,
      timeWindow: '1 minute',
      keyGenerator: (req) => {
        const header = req.headers.authorization;
        const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
        return token ? hashApiKey(token) : req.ip;
      },
    });
    v1.addHook('preHandler', requireApiKey);
    await v1.register(scrapeRoutes);
    await v1.register(mapRoutes);
    await v1.register(crawlRoutes);
    await v1.register(extractRoutes);
    await v1.register(screenshotRoutes);
  });

  await app.register(adminAuthRoutes);
  await app.register(adminSiteRoutes);
  await app.register(adminUrlRoutes);
  await app.register(adminJobRoutes);
  await app.register(adminApiKeyRoutes);
  await app.register(adminSettingsRoutes);
  await app.register(adminStatsRoutes);
  await app.register(adminCurrencyRateRoutes);
  await app.register(adminSalesRoutes);
  await app.register(adminPriceChangeRoutes);
  await app.register(adminKickioTeamRoutes);

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
