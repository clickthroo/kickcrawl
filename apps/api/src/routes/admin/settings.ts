import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../../db.js';
import { requireAdminSession } from '../../middleware/adminAuth.js';

const settingsSchema = z.object({
  global_rate_limit_rps: z.number().positive().optional(),
  default_user_agent: z.string().min(1).optional(),
  proxy_url: z.string().optional().nullable(),
  llm_provider: z.string().optional(),
  llm_model: z.string().optional(),
  notification_email: z.string().email().optional().nullable(),
  webhook_url: z.string().optional().nullable(),
});

export async function adminSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdminSession);

  app.get('/api/admin/settings', async (_req, reply) => {
    const { rows } = await pool.query('SELECT * FROM settings WHERE id = 1');
    return reply.send({ success: true, settings: rows[0] });
  });

  app.put('/api/admin/settings', async (req, reply) => {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: parsed.error.message });
    const s = parsed.data;

    const { rows } = await pool.query(
      `UPDATE settings SET
         global_rate_limit_rps = COALESCE($1, global_rate_limit_rps),
         default_user_agent = COALESCE($2, default_user_agent),
         proxy_url = COALESCE($3, proxy_url),
         llm_provider = COALESCE($4, llm_provider),
         llm_model = COALESCE($5, llm_model),
         notification_email = COALESCE($6, notification_email),
         webhook_url = COALESCE($7, webhook_url),
         updated_at = now()
       WHERE id = 1 RETURNING *`,
      [
        s.global_rate_limit_rps,
        s.default_user_agent,
        s.proxy_url,
        s.llm_provider,
        s.llm_model,
        s.notification_email,
        s.webhook_url,
      ],
    );
    return reply.send({ success: true, settings: rows[0] });
  });
}
