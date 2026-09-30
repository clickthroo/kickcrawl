import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { createHmac } from 'node:crypto';

const SECRET = 'test-webhook-secret';

function sign(body: string, secret: string = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
}

async function buildTestApp(configOverrides: { kickioWebhookSecret?: string } = { kickioWebhookSecret: SECRET }) {
  vi.resetModules();
  vi.doMock('../src/config.js', () => ({ config: configOverrides }));
  const query = vi.fn(async () => ({ rows: [] }));
  vi.doMock('../src/db.js', () => ({ pool: { query } }));

  const { kickioWebhookRoutes } = await import('../src/routes/webhooks/kickioSale.js');
  const app = Fastify();
  await app.register(kickioWebhookRoutes);
  return { app, query };
}

describe('POST /api/webhooks/kickio-sale', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('../src/config.js');
    vi.doUnmock('../src/db.js');
  });

  it('rejects with 503 when KICKIO_WEBHOOK_SECRET is not configured, rather than accepting an unsigned request', async () => {
    const { app } = await buildTestApp({ kickioWebhookSecret: '' });
    const body = JSON.stringify({ event: 'listing.sold', event_id: 'e1', source_url: 'https://example.com/x' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/kickio-sale',
      headers: { 'content-type': 'application/json' },
      payload: body,
    });

    expect(res.statusCode).toBe(503);
  });

  it('rejects with 401 when the signature header is missing', async () => {
    const { app } = await buildTestApp();
    const body = JSON.stringify({ event: 'listing.sold', event_id: 'e1', source_url: 'https://example.com/x' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/kickio-sale',
      headers: { 'content-type': 'application/json' },
      payload: body,
    });

    expect(res.statusCode).toBe(401);
  });

  it('rejects with 401 when the signature is wrong (signed with a different secret)', async () => {
    const { app } = await buildTestApp();
    const body = JSON.stringify({ event: 'listing.sold', event_id: 'e1', source_url: 'https://example.com/x' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/kickio-sale',
      headers: { 'content-type': 'application/json', 'x-kickio-signature': sign(body, 'wrong-secret') },
      payload: body,
    });

    expect(res.statusCode).toBe(401);
  });

  it('rejects with 401 on a signature that is valid hex but the wrong length, without throwing', async () => {
    const { app } = await buildTestApp();
    const body = JSON.stringify({ event: 'listing.sold', event_id: 'e1', source_url: 'https://example.com/x' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/kickio-sale',
      headers: { 'content-type': 'application/json', 'x-kickio-signature': 'sha256=deadbeef' },
      payload: body,
    });

    expect(res.statusCode).toBe(401);
  });

  it('acknowledges (200, ignored) a validly-signed but unrecognized event type, rather than erroring', async () => {
    const { app, query } = await buildTestApp();
    const body = JSON.stringify({ event: 'listing.relisted', event_id: 'e1', source_url: 'https://example.com/x' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/kickio-sale',
      headers: { 'content-type': 'application/json', 'x-kickio-signature': sign(body) },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ success: true, ignored: true });
    expect(query).not.toHaveBeenCalled();
  });

  it("marks the matching url's kickio_sold_via_kickio_at on a validly-signed listing.sold event, keyed by source_url == urls.url", async () => {
    const { app, query } = await buildTestApp();
    const body = JSON.stringify({
      event: 'listing.sold',
      event_id: 'e1',
      source_url: 'https://casualfootballshirts.co.uk/products/england-2006-home-shirt',
      order_id: 'order-1',
      sale_price_cents: 3999,
      currency: 'GBP',
      sold_at: '2026-09-29T18:00:00.000Z',
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/kickio-sale',
      headers: { 'content-type': 'application/json', 'x-kickio-signature': sign(body) },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ success: true });
    const update = query.mock.calls.find(([sql]) => String(sql).includes('kickio_sold_via_kickio_at'));
    expect(update).toBeDefined();
    expect(String(update![0])).toContain('COALESCE(kickio_sold_via_kickio_at, now())');
    expect(update![1]).toEqual(['https://casualfootballshirts.co.uk/products/england-2006-home-shirt']);
  });

  it('verifies against the exact raw bytes sent, not a re-serialized version - a body with different key order/whitespace than what was signed must fail', async () => {
    const { app } = await buildTestApp();
    const originalBody = JSON.stringify({ event: 'listing.sold', event_id: 'e1', source_url: 'https://example.com/x' });
    const signatureForOriginal = sign(originalBody);
    // Same data, re-serialized with different key order/spacing - a naive
    // "parse then re-stringify then sign" implementation would wrongly
    // accept this; this must still fail.
    const differentBytes = JSON.stringify({ source_url: 'https://example.com/x', event_id: 'e1', event: 'listing.sold' }, null, 2);

    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/kickio-sale',
      headers: { 'content-type': 'application/json', 'x-kickio-signature': signatureForOriginal },
      payload: differentBytes,
    });

    expect(res.statusCode).toBe(401);
  });
});
