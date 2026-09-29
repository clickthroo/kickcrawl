import { pool } from '../db.js';
import type { KickioProfile } from '../services/kickioProfile.js';
import {
  buildProductPayload,
  callKickioRpc,
  KickioSyncNotConfiguredError,
  isKickioSyncConfigured,
  type KickioProductPayload,
} from './kickioSync.js';

// Only the FIRST-ever successful listing submission is bounded by this -
// mirrors kickioSync.ts's own MAX_SYNC_ATTEMPTS, same reasoning (a row
// that's permanently held - e.g. no confident team match - stops being
// retried forever). Once an item's kickio_listing_synced_at is set,
// re-submission (to keep price/condition current) is never capped:
// import_kickio_listing is idempotent per source_url and self-reports
// whether anything actually changed, so there's no "give up" state for
// an item that's still genuinely for sale - the worker just keeps
// refreshing it every hour for as long as it stays In Stock.
export const MAX_LISTING_SYNC_ATTEMPTS = 5;

export interface ListingOutcome {
  success: boolean;
  error?: string;
  listingId?: string;
  action?: string;
  status?: string;
  priceChanged?: boolean;
}

interface ImportListingResult {
  action: string;
  listing_id: string;
  status: string;
  price_changed?: boolean;
}

export interface KickioListingPayload extends KickioProductPayload {
  price_cents: number;
  currency: string;
  condition: string | null;
  size: string | null;
  quantity: number;
}

/**
 * Builds the import_kickio_listing payload: every field
 * buildProductPayload already sends, plus the price/condition/size/
 * quantity Kickio's own Review Queue needs to show a real listing (not
 * just a bare product - see session history for why import_kickio_product
 * alone isn't enough). Read straight from the profile's own listing
 * fields, never a separately-passed price - unlike a completed sale
 * (which snapshots the price it sold at, permanently), a live listing's
 * price IS whatever the profile's own most recent scrape says it is
 * right now. A concrete return type (not a bare Record<string, unknown>)
 * so `'hold' in result` actually narrows - same reasoning as
 * buildProductPayload's own doc comment in kickioSync.ts.
 */
function buildListingPayload(urlId: string, profile: KickioProfile): KickioListingPayload | { hold: string } {
  const product = buildProductPayload(urlId, profile);
  if ('hold' in product) return product;

  if (profile.listing.price == null) return { hold: 'no price recorded for this listing' };

  return {
    ...product,
    price_cents: Math.round(profile.listing.price * 100),
    currency: profile.listing.currency ?? 'GBP',
    condition: profile.listing.condition,
    size: profile.listing.size,
    // A one-off vintage/game-worn item (the overwhelming majority of
    // what this app tracks) is always a single unit - default to 1
    // rather than leave it null, since Kickio's own quantity field isn't
    // meant to be optional/unknown the way some of KickioProfile's own
    // "never invent a value" fields are.
    quantity: profile.listing.quantity ?? 1,
  };
}

/**
 * Submits (creates or refreshes) one item's listing on Kickio - never
 * touches kickcrawl's own DB, same "build payload, call RPC, return the
 * outcome" shape as syncSaleToKickio in kickioSync.ts.
 */
export async function submitListingToKickio(urlId: string, profile: KickioProfile): Promise<ListingOutcome> {
  const built = buildListingPayload(urlId, profile);
  if ('hold' in built) {
    return { success: false, error: built.hold };
  }
  const result = await callKickioRpc<ImportListingResult>('import_kickio_listing', built);
  return {
    success: true,
    listingId: result.listing_id,
    action: result.action,
    status: result.status,
    priceChanged: result.price_changed,
  };
}

/**
 * Pulls one item's listing off Kickio - called once an item leaves
 * 'In Stock' (sold, on kickcrawl's own site, per the recorded sale) and
 * had a live listing there. Keyed by source_url, per Kickio's own
 * delist_kickio_listing contract - not by kickio_listing_id, since a
 * listing that's still pending review at delist time may not have been
 * matched/created into a product yet, but the source_url is always
 * known.
 */
export async function delistListingFromKickio(sourceUrl: string): Promise<ListingOutcome> {
  if (!isKickioSyncConfigured()) {
    throw new KickioSyncNotConfiguredError();
  }
  const result = await callKickioRpc<{ action?: string; status?: string }>('delist_kickio_listing', {
    source_url: sourceUrl,
  });
  return { success: true, action: result.action, status: result.status };
}

/**
 * Attempts one item's listing submission and persists whatever
 * happened - success, a deliberate hold, or a thrown exception all land
 * in the same kickio_listing_sync_attempts/kickio_listing_sync_error
 * columns either way, mirroring kickioSync.ts's syncAndPersistOutcome
 * for sales. Shared by workers/kickioListingSyncWorker.ts's hourly sweep
 * and any future admin manual-retry route.
 */
export async function syncListingAndPersistOutcome(urlId: string, profile: KickioProfile): Promise<ListingOutcome> {
  try {
    const outcome = await submitListingToKickio(urlId, profile);
    if (outcome.success) {
      await pool.query(
        `UPDATE urls SET kickio_listing_id = $2, kickio_listing_synced_at = now(), kickio_listing_sync_error = NULL
         WHERE id = $1`,
        [urlId, outcome.listingId ?? null],
      );
    } else {
      await pool.query(
        `UPDATE urls SET kickio_listing_sync_attempts = kickio_listing_sync_attempts + 1, kickio_listing_sync_error = $2
         WHERE id = $1`,
        [urlId, outcome.error ?? 'unknown error'],
      );
    }
    return outcome;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await pool.query(
      `UPDATE urls SET kickio_listing_sync_attempts = kickio_listing_sync_attempts + 1, kickio_listing_sync_error = $2
       WHERE id = $1`,
      [urlId, message],
    );
    console.error(`[kickioListingSync] url ${urlId} listing sync threw:`, message);
    return { success: false, error: message };
  }
}

/**
 * Attempts to delist one item and persists the outcome - kickio_delisted_at
 * set on success, kickio_listing_sync_error updated (reused, not a
 * second error column - see migration 022's own comment) on failure or
 * a thrown exception either way, so a failed delist shows up right next
 * to a failed listing submission in the same admin-visible field.
 */
export async function delistAndPersistOutcome(urlId: string, sourceUrl: string): Promise<ListingOutcome> {
  try {
    const outcome = await delistListingFromKickio(sourceUrl);
    if (outcome.success) {
      await pool.query(`UPDATE urls SET kickio_delisted_at = now(), kickio_listing_sync_error = NULL WHERE id = $1`, [
        urlId,
      ]);
    } else {
      await pool.query(`UPDATE urls SET kickio_listing_sync_error = $2 WHERE id = $1`, [
        urlId,
        outcome.error ?? 'unknown error',
      ]);
    }
    return outcome;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await pool.query(`UPDATE urls SET kickio_listing_sync_error = $2 WHERE id = $1`, [urlId, `delist failed: ${message}`]);
    console.error(`[kickioListingSync] url ${urlId} delist threw:`, message);
    return { success: false, error: message };
  }
}
