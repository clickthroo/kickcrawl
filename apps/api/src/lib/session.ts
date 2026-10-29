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

// Password reset. There's no email-sending capability anywhere in this app
// (no SMTP/API provider configured), so routes/admin/auth.ts prints the
// reset link to the deploy logs instead of emailing it - the admin already
// has Railway log access, and this is a single-operator internal tool, not
// a public signup product. Deliberately short-lived (15 minutes, vs the
// session token's 7 days) since it only ever needs to survive the trip
// from "request a reset" to "the admin reads the log and clicks it".
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;

interface ResetTokenPayload {
  adminId: string;
  email: string;
  // Fingerprint of the password hash this token was issued against, not
  // the hash itself (never put a real credential, even hashed, inside a
  // token that ends up sitting in server logs). Once the password actually
  // changes - including via this very token being redeemed - the
  // fingerprint no longer matches the admin's current row, so the token
  // can never be replayed. That gives one-time-use semantics without a
  // separate "used tokens" table to create, expire and clean up.
  passwordHashFingerprint: string;
  expiresAt: number;
}

function passwordHashFingerprint(passwordHash: string): string {
  return createHmac('sha256', config.sessionSecret).update(passwordHash).digest('hex').slice(0, 16);
}

// Prefixed before signing so a reset token's signature can never be
// presented as, or collide with, a session token's signature even if the
// two payloads' bytes ever coincided.
function signReset(body: string): string {
  return sign(`reset:${body}`);
}

export function createResetToken(adminId: string, email: string, currentPasswordHash: string): string {
  const payload: ResetTokenPayload = {
    adminId,
    email,
    passwordHashFingerprint: passwordHashFingerprint(currentPasswordHash),
    expiresAt: Date.now() + RESET_TOKEN_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${signReset(body)}`;
}

/**
 * Verifies a reset token's signature and expiry, returning its payload for
 * the caller to then check against the admin's CURRENT password_hash
 * (routes/admin/auth.ts) - this function only knows what was signed into
 * the token itself, not what's in the database now.
 */
export function verifyResetToken(token: string | undefined): ResetTokenPayload | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;

  const expectedSig = signReset(body);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const payload: ResetTokenPayload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
    if (payload.expiresAt < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function resetTokenMatchesCurrentPassword(payload: ResetTokenPayload, currentPasswordHash: string): boolean {
  return payload.passwordHashFingerprint === passwordHashFingerprint(currentPasswordHash);
}
