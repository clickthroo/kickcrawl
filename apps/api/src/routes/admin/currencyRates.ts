import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../../db.js';
import { requireAdminSession } from '../../middleware/adminAuth.js';

// ISO 4217-style code - not validated against the real currency list, since
// a site can report anything in its JSON-LD and the admin should still be
// able to add a rate for it.
const codeSchema = z.string().trim().min(1).max(10).transform((c) => c.toUpperCase());
const upsertSchema = z.object({ rate_to_gbp: z.number().positive() });

export async function adminCurrencyRateRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdminSession);

  app.get('/api/admin/currency-rates', async (_req, reply) => {
    const { rows } = await pool.query('SELECT * FROM currency_rates ORDER BY code');
    return reply.send({ success: true, rates: rows });
  });

  app.put('/api/admin/currency-rates/:code', async (req, reply) => {
    const codeResult = codeSchema.safeParse((req.params as { code: string }).code);
    const bodyResult = upsertSchema.safeParse(req.body);
    if (!codeResult.success) return reply.code(400).send({ success: false, error: codeResult.error.message });
    if (!bodyResult.success) return reply.code(400).send({ success: false, error: bodyResult.error.message });

    const { rows } = await pool.query(
      `INSERT INTO currency_rates (code, rate_to_gbp, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (code) DO UPDATE SET rate_to_gbp = EXCLUDED.rate_to_gbp, updated_at = now()
       RETURNING *`,
      [codeResult.data, bodyResult.data.rate_to_gbp],
    );
    return reply.send({ success: true, rate: rows[0] });
  });

  app.delete('/api/admin/currency-rates/:code', async (req, reply) => {
    const codeResult = codeSchema.safeParse((req.params as { code: string }).code);
    if (!codeResult.success) return reply.code(400).send({ success: false, error: codeResult.error.message });

    await pool.query('DELETE FROM currency_rates WHERE code = $1', [codeResult.data]);
    return reply.send({ success: true });
  });
}
