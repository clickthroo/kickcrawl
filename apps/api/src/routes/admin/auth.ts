import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from '../../db.js';
import { config } from '../../config.js';
import {
  createResetToken,
  createSessionToken,
  resetTokenMatchesCurrentPassword,
  SESSION_COOKIE_NAME,
  verifyResetToken,
  verifySessionToken,
} from '../../lib/session.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
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

  // No email provider is configured anywhere in this app, so the reset
  // link is printed to the deploy logs rather than emailed - the admin
  // already has Railway log access, and this is a single-operator internal
  // tool, not a public product with real end users to notify. Always
  // responds success regardless of whether the email matched a real admin,
  // so this can never be used to enumerate which addresses have accounts.
  app.post('/api/admin/auth/forgot-password', async (req, reply) => {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Invalid email' });
    }
    const { email } = parsed.data;

    const { rows } = await pool.query('SELECT id, email, password_hash FROM admin_users WHERE email = $1', [
      email,
    ]);
    const admin = rows[0];
    if (admin) {
      const token = createResetToken(admin.id, admin.email, admin.password_hash);
      const resetLink = `${config.appUrl}/reset-password?token=${token}`;
      console.log(`[admin] password reset requested for ${admin.email} - reset link: ${resetLink}`);
    }
    return reply.send({ success: true });
  });

  app.post('/api/admin/auth/reset-password', async (req, reply) => {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: 'Password must be at least 8 characters' });
    }
    const { token, password } = parsed.data;

    const payload = verifyResetToken(token);
    if (!payload) {
      return reply.code(400).send({ success: false, error: 'This reset link is invalid or has expired' });
    }

    const { rows } = await pool.query('SELECT id, password_hash FROM admin_users WHERE id = $1', [payload.adminId]);
    const admin = rows[0];
    // Also covers a token that's already been redeemed once - the password
    // hash it was fingerprinted against no longer matches after that first
    // reset, so a replay of the same link lands here too.
    if (!admin || !resetTokenMatchesCurrentPassword(payload, admin.password_hash)) {
      return reply.code(400).send({ success: false, error: 'This reset link is invalid or has expired' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await pool.query('UPDATE admin_users SET password_hash = $1 WHERE id = $2', [passwordHash, admin.id]);
    return reply.send({ success: true });
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
