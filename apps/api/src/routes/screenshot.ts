import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getBrowser } from '../services/browser.js';
import { guardNavigation } from '../services/fetcher.js';
import { randomUserAgent } from '../services/userAgents.js';
import { resolveSiteForUrl } from '../lib/siteResolver.js';
import { acquireSlot } from '../services/rateLimiter.js';
import { assertSafeUrl, UnsafeUrlError } from '../services/urlSafety.js';

const screenshotSchema = z.object({
  url: z.string().url(),
  fullPage: z.boolean().optional().default(false),
});

export async function screenshotRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/screenshot', async (req, reply) => {
    const parsed = screenshotSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: parsed.error.message });
    }
    const { url, fullPage } = parsed.data;

    try {
      await assertSafeUrl(url);
    } catch (err) {
      return reply
        .code(400)
        .send({ success: false, error: err instanceof UnsafeUrlError ? err.message : 'Unsafe URL' });
    }

    const site = await resolveSiteForUrl(url);
    await acquireSlot(new URL(url).hostname, site?.rate_limit_rps ?? 1);

    const browser = await getBrowser();
    const context = await browser.newContext({ userAgent: randomUserAgent() });
    try {
      const page = await context.newPage();
      await guardNavigation(page);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      const buffer = await page.screenshot({ fullPage, type: 'png' });
      return reply.send({
        success: true,
        screenshot: `data:image/png;base64,${buffer.toString('base64')}`,
        metadata: { sourceURL: url },
      });
    } catch (err) {
      return reply
        .code(502)
        .send({ success: false, error: err instanceof Error ? err.message : 'Screenshot failed' });
    } finally {
      await context.close();
    }
  });
}
