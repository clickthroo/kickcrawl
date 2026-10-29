import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import bcrypt from 'bcryptjs';

describe('POST /api/admin/auth/forgot-password', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.doUnmock('../src/db.js');
  });

  it('logs a reset link when the email matches an admin', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const query = vi.fn(async () => ({
      rows: [{ id: 'admin-1', email: 'admin@kickio.com', password_hash: '$2a$10$abc' }],
    }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));

    const { adminAuthRoutes } = await import('../src/routes/admin/auth.js');
    const app = Fastify();
    await app.register(adminAuthRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/forgot-password',
      payload: { email: 'admin@kickio.com' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ success: true });
    const logged = logSpy.mock.calls.map((args) => args.join(' ')).join('\n');
    expect(logged).toContain('admin@kickio.com');
    expect(logged).toContain('/reset-password?token=');
    await app.close();
  });

  // Never confirms or denies whether an email has an account - otherwise
  // this endpoint would be a ready-made way to enumerate admin addresses.
  it('responds success without logging anything when the email matches no admin', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const query = vi.fn(async () => ({ rows: [] }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));

    const { adminAuthRoutes } = await import('../src/routes/admin/auth.js');
    const app = Fastify();
    await app.register(adminAuthRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/forgot-password',
      payload: { email: 'nobody@kickio.com' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ success: true });
    expect(logSpy).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects a malformed email with 400 rather than querying the database', async () => {
    const query = vi.fn();
    vi.doMock('../src/db.js', () => ({ pool: { query } }));

    const { adminAuthRoutes } = await import('../src/routes/admin/auth.js');
    const app = Fastify();
    await app.register(adminAuthRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/forgot-password',
      payload: { email: 'not-an-email' },
    });

    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('POST /api/admin/auth/reset-password', () => {
  const currentHash = '$2a$10$currentHashAbcdefghijkl';

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.doUnmock('../src/db.js');
  });

  it('accepts a valid, unused token and updates the stored password hash', async () => {
    const { createResetToken } = await import('../src/lib/session.js');
    const token = createResetToken('admin-1', 'admin@kickio.com', currentHash);

    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('SELECT')) return { rows: [{ id: 'admin-1', password_hash: currentHash }] };
      return { rows: [] };
    });
    vi.doMock('../src/db.js', () => ({ pool: { query } }));

    const { adminAuthRoutes } = await import('../src/routes/admin/auth.js');
    const app = Fastify();
    await app.register(adminAuthRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/reset-password',
      payload: { token, password: 'a-new-long-password' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ success: true });
    const updateCall = query.mock.calls.find(([sql]) => (sql as string).startsWith('UPDATE'));
    expect(updateCall).toBeTruthy();
    const [, params] = updateCall as [string, [string, string]];
    expect(params[1]).toBe('admin-1');
    expect(await bcrypt.compare('a-new-long-password', params[0])).toBe(true);
    await app.close();
  });

  it('rejects a token already redeemed once - its fingerprint no longer matches the changed hash', async () => {
    const { createResetToken } = await import('../src/lib/session.js');
    const token = createResetToken('admin-1', 'admin@kickio.com', currentHash);

    const alreadyChangedHash = '$2a$10$someDifferentHashAfterAnEarlierReset';
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith('SELECT')) return { rows: [{ id: 'admin-1', password_hash: alreadyChangedHash }] };
      return { rows: [] };
    });
    vi.doMock('../src/db.js', () => ({ pool: { query } }));

    const { adminAuthRoutes } = await import('../src/routes/admin/auth.js');
    const app = Fastify();
    await app.register(adminAuthRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/reset-password',
      payload: { token, password: 'a-new-long-password' },
    });

    expect(res.statusCode).toBe(400);
    expect(query.mock.calls.some(([sql]) => (sql as string).startsWith('UPDATE'))).toBe(false);
    await app.close();
  });

  it('rejects an invalid/forged token without touching the database', async () => {
    const query = vi.fn();
    vi.doMock('../src/db.js', () => ({ pool: { query } }));

    const { adminAuthRoutes } = await import('../src/routes/admin/auth.js');
    const app = Fastify();
    await app.register(adminAuthRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/reset-password',
      payload: { token: 'not-a-real-token', password: 'a-new-long-password' },
    });

    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects a too-short password before ever checking the token', async () => {
    const query = vi.fn();
    vi.doMock('../src/db.js', () => ({ pool: { query } }));

    const { adminAuthRoutes } = await import('../src/routes/admin/auth.js');
    const app = Fastify();
    await app.register(adminAuthRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/reset-password',
      payload: { token: 'whatever', password: 'short' },
    });

    expect(res.statusCode).toBe(400);
    expect(query).not.toHaveBeenCalled();
    await app.close();
  });
});
