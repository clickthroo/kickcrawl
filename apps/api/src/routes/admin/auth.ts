import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from '../../db.js';
import { createSessionToken, SESSION_COOKIE_NAME, verifySessionToken } from '../../lib/session.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function adminAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/admin/auth/login', async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid email or password' });
    }
    const { email, password } = parsed.data;

    const { rows } = await pool.query('SELECT id, email, password_hash FROM admin_users WHERE email = $1', [
      email,
    ]);
    const admin = rows[0];
    if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
      return reply.code(401).send({ success: false, error: 'Invalid email or password' });
    }

    const token = createSessionToken(admin.id, admin.email);
    reply.setCookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    });
    return reply.send({ success: true, email: admin.email });
  });

  app.post('/api/admin/auth/logout', async (req, reply) => {
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return reply.send({ success: true });
  });

  app.get('/api/admin/auth/me', async (req, reply) => {
    const session = verifySessionToken(req.cookies?.[SESSION_COOKIE_NAME]);
    if (!session) return reply.code(401).send({ success: false });
    return reply.send({ success: true, email: session.email });
  });
}
