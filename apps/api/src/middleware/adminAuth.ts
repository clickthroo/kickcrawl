import type { FastifyReply, FastifyRequest } from 'fastify';
import { SESSION_COOKIE_NAME, verifySessionToken } from '../lib/session.js';

export async function requireAdminSession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE_NAME];
  const session = verifySessionToken(token);
  if (!session) {
    reply.code(401).send({ success: false, error: 'Not authenticated' });
    return;
  }
  (req as FastifyRequest & { admin: typeof session }).admin = session;
}
