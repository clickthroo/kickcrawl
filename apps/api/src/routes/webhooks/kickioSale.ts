import type { FastifyInstance } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../../config.js';
import { pool } from '../../db.js';

// Kickio's own confirmed contract (session history) - fired the moment a
// listing sells ON Kickio itself, so kickcrawl can stop treating it as
// still-active without waiting for its own next hourly recheck of the
// retailer's page to notice.
interface KickioSaleWebhookPayload {
  event: string;
  event_id: string;
  source_url: string;
  listing_id?: string;
  order_id?: string;
  sale_price_cents?: number;
  currency?: string;
  sold_at?: string;
}

const SIGNATURE_HEADER = 'x-kickio-signature';

/**
 * HMAC-SHA256 over the RAW request body, `sha256=<hex-digest>` (Kickio's
 * own confirmed scheme, matching GitHub's webhook convention) - never the
 * parsed-then-re-serialized body, since JSON.stringify can differ from
 * whatever bytes Kickio actually signed (key order, whitespace) and would
 * silently break every check. timingSafeEqual needs equal-length buffers;
 * a length mismatch is itself proof of an invalid signature, not a case to
 * throw on.
 */
function verifySignature(rawBody: string, header: string | undefined, secret: string): boolean {
  const match = header ? /^sha256=([0-9a-f]+)$/i.exec(header) : null;
  if (!match) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(match[1], 'hex');
  } catch {
    return false;
  }
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(expected, provided);
}

export async function kickioWebhookRoutes(app: FastifyInstance): Promise<void> {
  // Scoped to a child instance so this custom parser (which hands back the
  // raw string instead of Fastify's normal auto-parsed JSON object) never
  // changes how any other route - admin, v1 - parses its own body.
  await app.register(async (instance) => {
    instance.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
      done(null, body);
    });

    instance.post('/api/webhooks/kickio-sale', async (req, reply) => {
      if (!config.kickioWebhookSecret) {
        req.log.error('[kickioWebhook] KICKIO_WEBHOOK_SECRET not configured - rejecting delivery');
        return reply.code(503).send({ success: false, error: 'Webhook not configured' });
      }

      const rawBody = req.body as unknown as string;
      const signatureHeader = req.headers[SIGNATURE_HEADER] as string | undefined;
      if (!verifySignature(rawBody, signatureHeader, config.kickioWebhookSecret)) {
        return reply.code(401).send({ success: false, error: 'Invalid signature' });
      }

      let payload: KickioSaleWebhookPayload;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return reply.code(400).send({ success: false, error: 'Invalid JSON body' });
      }

      // Acknowledge (2xx) an event type we don't handle (yet) or a
      // malformed payload rather than letting it burn through Kickio's own
      // ~31h retry schedule (2min/10min/1h/6h/24h) for something neither
      // side can fix by retrying the exact same request again.
      if (payload.event !== 'listing.sold' || !payload.source_url) {
        return reply.send({ success: true, ignored: true });
      }

      // Keyed by source_url == urls.url directly - every product/listing
      // payload we've ever sent Kickio uses profile.source.url (always
      // exactly the scraped urls.url, never re-derived) as this same
      // source_url, so no separate lookup column is needed to match back.
      //
      // COALESCE, not an unconditional `now()` - Kickio's own retry
      // schedule can (and, per their own note, does) redeliver the same
      // event_id more than once; the first-received timestamp should
      // survive a redelivery, not keep getting bumped forward.
      await pool.query(
        `UPDATE urls SET kickio_sold_via_kickio_at = COALESCE(kickio_sold_via_kickio_at, now()) WHERE url = $1`,
        [payload.source_url],
      );

      return reply.send({ success: true });
    });
  });
}
