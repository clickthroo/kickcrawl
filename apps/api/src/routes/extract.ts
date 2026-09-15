import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { pool } from '../db.js';
import { fetchPage } from '../services/fetcher.js';
import { extractBySelectors, extractWithLlm, type JsonSchema } from '../services/extractor.js';
import { resolveSiteForUrl } from '../lib/siteResolver.js';
import { markUrlFetched } from '../lib/urlStore.js';

const extractSchema = z.object({
  url: z.string().url(),
  schema: z.record(z.enum(['string', 'number', 'boolean'])),
});

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function hashSchema(schema: JsonSchema): string {
  return createHash('sha256').update(JSON.stringify(schema)).digest('hex');
}

export async function extractRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/extract', async (req, reply) => {
    const parsed = extractSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: parsed.error.message });
    }
    const { url, schema } = parsed.data;
    const schemaHash = hashSchema(schema);

    const cached = await pool.query(
      `SELECT result FROM extract_cache WHERE url = $1 AND schema_hash = $2 AND created_at > now() - interval '24 hours'`,
      [url, schemaHash],
    );
    if (cached.rows.length > 0) {
      return reply.send({ success: true, json: cached.rows[0].result, metadata: { sourceURL: url }, cached: true });
    }

    const site = await resolveSiteForUrl(url);
    const result = await fetchPage(url, {
      useBrowser: site?.use_browser_default,
      rateLimitRps: site?.rate_limit_rps,
    });

    if (result.error || !result.html) {
      return reply.code(502).send({ success: false, error: result.error ?? 'Fetch failed' });
    }

    let json: Record<string, unknown> = {};
    const selectors = site?.default_selectors ?? {};
    if (Object.keys(selectors).length > 0) {
      json = extractBySelectors(result.html, selectors);
    }

    const missingFields = Object.keys(schema).filter((f) => json[f] === undefined);
    if (missingFields.length > 0) {
      try {
        const llmSchema = Object.fromEntries(
          missingFields.map((f) => [f, schema[f]]),
        ) as JsonSchema;
        const llmResult = await extractWithLlm(result.html, llmSchema);
        json = { ...json, ...llmResult };
      } catch (err) {
        if (Object.keys(json).length === 0) {
          return reply
            .code(502)
            .send({ success: false, error: err instanceof Error ? err.message : 'Extraction failed' });
        }
      }
    }

    await pool.query(
      `INSERT INTO extract_cache (url, schema_hash, result) VALUES ($1, $2, $3)
       ON CONFLICT (url, schema_hash) DO UPDATE SET result = EXCLUDED.result, created_at = now()`,
      [url, schemaHash, JSON.stringify(json)],
    );

    if (site) {
      await markUrlFetched(site.id, url, result.statusCode).catch(() => undefined);
    }

    return reply.send({ success: true, json, metadata: { sourceURL: url } });
  });
}
