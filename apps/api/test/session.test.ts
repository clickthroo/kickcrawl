import { describe, expect, it } from 'vitest';
import { createSessionToken, verifySessionToken } from '../src/lib/session.js';

describe('session tokens', () => {
  it('round-trips a valid token', () => {
    const token = createSessionToken('admin-1', 'admin@kickio.com');
    const session = verifySessionToken(token);
    expect(session?.adminId).toBe('admin-1');
    expect(session?.email).toBe('admin@kickio.com');
  });

  it('rejects a tampered token', () => {
    const token = createSessionToken('admin-1', 'admin@kickio.com');
    const [body] = token.split('.');
    const tamperedPayload = Buffer.from(
      JSON.stringify({ adminId: 'attacker', email: 'x@x.com', expiresAt: Date.now() + 100000 }),
    ).toString('base64url');
    const tampered = `${tamperedPayload}.${token.split('.')[1]}`;
    expect(verifySessionToken(tampered)).toBeNull();
    expect(body).toBeTruthy();
  });

  it('rejects a missing token', () => {
    expect(verifySessionToken(undefined)).toBeNull();
  });

  it('rejects an expired token', () => {
    const original = Date.now;
    Date.now = () => original() - 8 * 24 * 60 * 60 * 1000;
    const token = createSessionToken('admin-1', 'admin@kickio.com');
    Date.now = original;
    expect(verifySessionToken(token)).toBeNull();
  });
});
