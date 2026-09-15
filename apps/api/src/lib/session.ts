import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE_NAME = 'kc_session';

interface SessionPayload {
  adminId: string;
  email: string;
  expiresAt: number;
}

function sign(payload: string): string {
  return createHmac('sha256', config.sessionSecret).update(payload).digest('hex');
}

export function createSessionToken(adminId: string, email: string): string {
  const payload: SessionPayload = { adminId, email, expiresAt: Date.now() + SESSION_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = sign(body);
  return `${body}.${sig}`;
}

export function verifySessionToken(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;

  const expectedSig = sign(body);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const payload: SessionPayload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
    if (payload.expiresAt < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
