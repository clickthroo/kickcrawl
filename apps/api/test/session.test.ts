import { describe, expect, it } from 'vitest';
import {
  createResetToken,
  createSessionToken,
  resetTokenMatchesCurrentPassword,
  verifyResetToken,
  verifySessionToken,
} from '../src/lib/session.js';

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

describe('password reset tokens', () => {
  const currentHash = '$2a$10$abcdefghijklmnopqrstuv';

  it('round-trips a valid token and matches the password hash it was issued against', () => {
    const token = createResetToken('admin-1', 'admin@kickio.com', currentHash);
    const payload = verifyResetToken(token);
    expect(payload?.adminId).toBe('admin-1');
    expect(payload?.email).toBe('admin@kickio.com');
    expect(payload && resetTokenMatchesCurrentPassword(payload, currentHash)).toBe(true);
  });

  it('never puts the real password hash in the token itself - only a fingerprint of it', () => {
    const token = createResetToken('admin-1', 'admin@kickio.com', currentHash);
    const [body] = token.split('.');
    expect(Buffer.from(body, 'base64url').toString('utf-8')).not.toContain(currentHash);
  });

  // The actual one-time-use mechanism: once a reset (including the one this
  // very token performs) changes admin_users.password_hash, the token's
  // embedded fingerprint no longer matches the row - so a replayed link
  // fails the same way an outright-forged one would, with no separate
  // "used tokens" table required.
  it('stops matching once the password hash it was issued against has changed', () => {
    const token = createResetToken('admin-1', 'admin@kickio.com', currentHash);
    const payload = verifyResetToken(token);
    const newHash = '$2a$10$zzzzzzzzzzzzzzzzzzzzzz';
    expect(payload && resetTokenMatchesCurrentPassword(payload, newHash)).toBe(false);
  });

  it('rejects a tampered reset token', () => {
    const token = createResetToken('admin-1', 'admin@kickio.com', currentHash);
    const [, sig] = token.split('.');
    const tamperedPayload = Buffer.from(
      JSON.stringify({
        adminId: 'attacker',
        email: 'x@x.com',
        passwordHashFingerprint: 'forged',
        expiresAt: Date.now() + 100000,
      }),
    ).toString('base64url');
    expect(verifyResetToken(`${tamperedPayload}.${sig}`)).toBeNull();
  });

  it('rejects a missing token', () => {
    expect(verifyResetToken(undefined)).toBeNull();
  });

  it('rejects an expired token - deliberately much shorter-lived than a session token', () => {
    const original = Date.now;
    Date.now = () => original() - 20 * 60 * 1000;
    const token = createResetToken('admin-1', 'admin@kickio.com', currentHash);
    Date.now = original;
    expect(verifyResetToken(token)).toBeNull();
  });

  it("a session token's signature is never valid as a reset token's, even with the same payload shape", () => {
    // Both sign with HMAC-SHA256 under the same secret - the "reset:" prefix
    // (session.ts's signReset) is what keeps the two token kinds from being
    // interchangeable, not the algorithm.
    const sessionToken = createSessionToken('admin-1', 'admin@kickio.com');
    const [body] = sessionToken.split('.');
    const resetToken = createResetToken('admin-1', 'admin@kickio.com', currentHash);
    const [, resetSig] = resetToken.split('.');
    expect(verifyResetToken(`${body}.${resetSig}`)).toBeNull();
  });
});
