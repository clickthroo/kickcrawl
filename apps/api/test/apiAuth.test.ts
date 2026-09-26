import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashApiKey } from '../src/lib/apiKeys.js';

function fakeReply() {
  return {
    statusCode: undefined as number | undefined,
    body: undefined as unknown,
    code(status: number) {
      this.statusCode = status;
      return this;
    },
    send(body: unknown) {
      this.body = body;
      return this;
    },
  };
}

describe('requireApiKey', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('rejects a request with no Authorization header, without touching the database', async () => {
    const query = vi.fn();
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    const { requireApiKey } = await import('../src/middleware/apiAuth.js');

    const req = { headers: {} } as unknown as Parameters<typeof requireApiKey>[0];
    const reply = fakeReply();
    await requireApiKey(req, reply as never);

    expect(reply.statusCode).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a key with no matching row and never attaches an apiKeyId', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    const { requireApiKey } = await import('../src/middleware/apiAuth.js');

    const req = { headers: { authorization: 'Bearer kc_nope' } } as unknown as Parameters<
      typeof requireApiKey
    >[0];
    const reply = fakeReply();
    await requireApiKey(req, reply as never);

    expect(reply.statusCode).toBe(401);
    expect((req as { apiKeyId?: string }).apiKeyId).toBeUndefined();
  });

  it('accepts a valid key, records last_used_at, and attaches apiKeyId to the request', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT id FROM api_keys')) return { rows: [{ id: 'key-1' }] };
      return { rows: [] };
    });
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    const { requireApiKey } = await import('../src/middleware/apiAuth.js');

    const req = { headers: { authorization: 'Bearer kc_real' } } as unknown as Parameters<
      typeof requireApiKey
    >[0];
    const reply = fakeReply();
    await requireApiKey(req, reply as never);

    expect(reply.statusCode).toBeUndefined();
    expect((req as { apiKeyId?: string }).apiKeyId).toBe('key-1');
    const updateCall = query.mock.calls.find(([sql]) => (sql as string).includes('UPDATE api_keys SET last_used_at'));
    expect(updateCall?.[1]).toEqual(['key-1']);
  });

  it('looks the key up by the same hash hashApiKey produces, so a real key actually matches its stored row', async () => {
    const query = vi.fn(async () => ({ rows: [{ id: 'key-2' }] }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    const { requireApiKey } = await import('../src/middleware/apiAuth.js');

    const req = { headers: { authorization: 'Bearer kc_abc123' } } as unknown as Parameters<
      typeof requireApiKey
    >[0];
    const reply = fakeReply();
    await requireApiKey(req, reply as never);

    const lookupCall = query.mock.calls.find(([sql]) => (sql as string).includes('SELECT id FROM api_keys'));
    expect(lookupCall?.[1]).toEqual([hashApiKey('kc_abc123')]);
  });
});
