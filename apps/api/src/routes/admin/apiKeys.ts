import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../../db.js';
import { requireAdminSession } from '../../middleware/adminAuth.js';
import { generateApiKey, hashApiKey } from '../../lib/apiKeys.js';

const createSchema = z.object({ name: z.string().min(1) });

export async function adminApiKeyRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdminSession);

  app.get('/api/admin/api-keys', async (_req, reply) => {
    const { rows } = await pool.query(
      'SELECT id, name, key_preview, last_used_at, created_at FROM api_keys ORDER BY created_at DESC',
    );
    return reply.send({ success: true, apiKeys: rows });
  });

  app.post('/api/admin/api-keys', async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.message });

    const { plain, preview } = generateApiKey();
    const hash = hashApiKey(plain);
    const { rows } = await pool.query(
      'INSERT INTO api_keys (name, key_hash, key_preview) VALUES ($1, $2, $3) RETURNING id, name, key_preview, created_at',
      [parsed.data.name, hash, preview],
    );
    // The plaintext key is only ever returned here, at creation time.
    return reply.send({ success: true, apiKey: rows[0], plainKey: plain });
  });

  app.delete('/api/admin/api-keys/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await pool.query('DELETE FROM api_keys WHERE id = $1', [id]);
    return reply.send({ success: true });
  });
}
