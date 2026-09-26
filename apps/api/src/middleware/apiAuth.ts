import type { FastifyReply, FastifyRequest } from 'fastify';
import { pool } from '../db.js';
import { hashApiKey } from '../lib/apiKeys.js';

export interface ApiKeyRequest extends FastifyRequest {
  apiKeyId: string;
}

export async function requireApiKey(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!token) {
    reply.code(401).send({ success: false, error: 'Missing Authorization: Bearer <api_key> header' });
    return;
  }

  const hash = hashApiKey(token);
  const { rows } = await pool.query('SELECT id FROM api_keys WHERE key_hash = $1', [hash]);
  if (rows.length === 0) {
    reply.code(401).send({ success: false, error: 'Invalid API key' });
    return;
  }

  await pool.query('UPDATE api_keys SET last_used_at = now() WHERE id = $1', [rows[0].id]);
  // Attached so a route handler can scope what it reads/writes to this
  // specific caller (routes/crawl.ts's job-ownership check) instead of
  // every valid key being able to see every other key's data.
  (req as ApiKeyRequest).apiKeyId = rows[0].id;
}
