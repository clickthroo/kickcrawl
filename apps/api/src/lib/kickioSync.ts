import { config } from '../config.js';
import { pool } from '../db.js';
import type { KickioProfile } from '../services/kickioProfile.js';

// How many hourly sync attempts a held/failing sale gets before
// kickioSyncWorker.ts stops picking it back up automatically. Shared here
// (not duplicated in the worker or the admin retry route) so both agree on
// exactly when a sale counts as "stuck" rather than just "held" - the
// admin UI needs that same threshold to flag a sale as needing manual
// attention, and the manual retry endpoint needs it to know it's the one
// remaining way back for a sale that's already hit the cap.
export const MAX_SYNC_ATTEMPTS = 5;

export class KickioSyncNotConfiguredError extends Error {
  constructor() {
    super('KICKIO_SUPABASE_URL / KICKIO_SUPABASE_SERVICE_ROLE_KEY are not configured');
  }
}

export function isKickioSyncConfigured(): boolean {
  return Boolean(config.kickioSupabaseUrl && config.kickioSupabaseServiceRoleKey);
}

export interface SaleForSync {
  id: string;
  url_id: string;
  price: number | null;
  currency: string | null;
  detected_at: string;
  profile: KickioProfile | null;
}

export interface KickioSyncOutcome {
  success: boolean;
  error?: string;
  productId?: string;
  saleId?: string;
  action?: string;
}

const KICKIO_RPC_TIMEOUT_MS = 15_000;

// Exported so lib/kickioListingSync.ts can share this same RPC-calling
// machinery (timeout, auth headers, error surfacing) instead of
// duplicating it - both files talk to the same Kickio PostgREST RPC
// convention (a single jsonb `p` parameter).
export async function callKickioRpc<T>(fn: string, payload: object): Promise<T> {
  if (!isKickioSyncConfigured()) {
    throw new KickioSyncNotConfiguredError();
  }
  const url = new URL(`/rest/v1/rpc/${fn}`, config.kickioSupabaseUrl);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: config.kickioSupabaseServiceRoleKey,
      Authorization: `Bearer ${config.kickioSupabaseServiceRoleKey}`,
      'Content-Type': 'application/json',
    },
    // Both import_kickio_product and import_kickio_sale take a single
    // jsonb parameter named `p` - PostgREST's RPC calling convention maps
    // the request body's own keys 1:1 to the function's named parameters.
    body: JSON.stringify({ p: payload }),
    signal: AbortSignal.timeout(KICKIO_RPC_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Kickio ${fn} failed: ${res.status} ${res.statusText}${text ? ` - ${text}` : ''}`);
  }
  return (await res.json()) as T;
}

interface ImportProductResult {
  product_id: string;
  matched_by: string;
  action: string;
}

interface ImportSaleResult {
  action: string;
  product_id?: string;
  sale_id?: string;
  reason?: string;
}

interface KickioIdentityFields {
  team: string;
  season: string | null;
  shirt_type: string | null;
  gender: string;
  issue: string | null;
  special_edition: string | null;
  sleeves: string | null;
  boxed_edition: string | null;
  signed: string | null;
  manufacturer: string | null;
}

/**
 * The identity fields every Kickio RPC payload shares - team always
 * comes from identity.team_kickio_match, never the raw identity.team
 * guess, per the already-decided write-integration policy (kickioProfile.ts
 * KickioProfile.identity.team_kickio_match's own doc comment): Kickio's
 * live product catalog should only ever be written to with a verified
 * team match, never a scraped guess, on pain of polluting it with wrong
 * or duplicate teams that are hard to clean up later. Returns null (not
 * an error - a deliberate hold) when there's no confident match to send
 * yet.
 */
function deriveIdentity(profile: KickioProfile): KickioIdentityFields | { hold: string } {
  const team = profile.identity.team_kickio_match;
  if (!team) return { hold: 'no confident Kickio team match - held for review, never sent as a guess' };

  return {
    team,
    season: profile.identity.season,
    shirt_type: profile.identity.shirt_type,
    gender: profile.identity.gender,
    issue: profile.identity.issue,
    special_edition: profile.identity.special_edition,
    sleeves: profile.identity.sleeves,
    boxed_edition: profile.listing.boxed_edition,
    signed: profile.identity.signed,
    manufacturer: profile.listing.manufacturer,
  };
}

export interface KickioProductPayload extends KickioIdentityFields {
  id: string;
  player: string | null;
  number: string | null;
  colour: string | null;
  image_url: string | null;
  extra_seasons: string[];
  source_url: string;
  /**
   * The retailer's own listing write-up (kickioProfile.ts's
   * KickioListing.description - schema.org's Product.description, a
   * site-configured selector, or the page's own meta/og:description, in
   * that order). Sent on every product/listing push regardless of whether
   * Kickio's own schema stores/shows it yet - same "send it now so a
   * future backfill isn't needed once Kickio's side is ready" reasoning
   * already used for source_url above.
   */
  description: string | null;
}

/**
 * Builds the import_kickio_product payload - shared by the real
 * sale-triggered sync below and lib/kickioListingSync.ts's real listing
 * payload (a listing is this same shape plus price/condition/size/
 * quantity). A concrete return type (not a bare Record<string, unknown>)
 * so `'hold' in result` actually narrows - TypeScript can't exclude an
 * index-signature type from a "has this property" check, since it could
 * always have it. Exported for that reuse.
 */
export function buildProductPayload(urlId: string, profile: KickioProfile): KickioProductPayload | { hold: string } {
  const identity = deriveIdentity(profile);
  if ('hold' in identity) return identity;

  return {
    id: urlId,
    ...identity,
    player: profile.identity.player,
    number: profile.identity.number,
    colour: profile.listing.colour,
    image_url: profile.listing.images[0] ?? null,
    extra_seasons: profile.identity.extra_seasons,
    description: profile.listing.description,
    // The original listing page, exactly as scraped - not re-derived from
    // anything that could drift (the source site's URL can outlive its own
    // page: this is the same snapshot kept in sales.profile.source.url even
    // after the page later changes or 404s). Lets a Kickio reviewer open
    // the real listing to eyeball a KickCrawl-sourced team/season/etc guess
    // against it, particularly team_kickio_match, which is never a
    // certainty beyond "best available match" - see that field's own doc
    // comment above.
    source_url: profile.source.url,
  };
}

/**
 * Builds the payload for both Kickio RPCs from a stored sale row - see
 * buildProductPayload/deriveIdentity above for the parts this shares with
 * the product-only path. Returns null (not an error - a deliberate hold)
 * when the sale isn't safe to send yet.
 */
function buildPayloads(
  sale: SaleForSync,
): { product: KickioProductPayload; sale: Record<string, unknown> } | { hold: string } {
  const profile = sale.profile;
  if (!profile) return { hold: 'no stored profile snapshot on this sale' };

  const identity = deriveIdentity(profile);
  if ('hold' in identity) return identity;

  if (sale.price == null) return { hold: 'no price recorded for this sale' };

  const product = buildProductPayload(sale.url_id, profile);
  if ('hold' in product) return product;

  const saleRpc = {
    kickio_shirt_id: sale.url_id,
    sold_at: sale.detected_at,
    price_cents: Math.round(sale.price * 100),
    currency: sale.currency ?? 'GBP',
    condition: profile.listing.condition,
    size: profile.listing.size,
    ...identity,
    player_name: profile.identity.player,
    number: profile.identity.number,
  };

  return { product, sale: saleRpc };
}

/**
 * Pushes one recorded sale to Kickio: match-or-create the product first
 * (Kickio's own match_or_create_product, via import_kickio_product), then
 * attach the sale to it (import_kickio_sale) using the same id both calls
 * share as kickio_shirt_id - import_kickio_sale's own external_ref lookup
 * then lands on exactly the product the first call just matched or
 * created, without needing its identity-match fallback trigger at all.
 */
export async function syncSaleToKickio(sale: SaleForSync): Promise<KickioSyncOutcome> {
  const built = buildPayloads(sale);
  if ('hold' in built) {
    return { success: false, error: built.hold };
  }

  const productResult = await callKickioRpc<ImportProductResult>('import_kickio_product', built.product);
  const saleResult = await callKickioRpc<ImportSaleResult>('import_kickio_sale', built.sale);

  return {
    success: true,
    productId: productResult.product_id,
    saleId: saleResult.sale_id,
    action: saleResult.action,
  };
}

/**
 * Attempts one sale's sync and persists whatever happened - success,
 * a deliberate hold, or a thrown exception all land in the same
 * kickio_sync_attempts/kickio_sync_error columns either way. Shared by
 * workers/kickioSyncWorker.ts's hourly sweep and the admin "retry now"
 * route (routes/admin/sales.ts), so a manual retry updates the exact same
 * bookkeeping an automatic one would - a sale retried by hand and then
 * left alone still ages out via the normal MAX_SYNC_ATTEMPTS path instead
 * of silently bypassing it.
 */
export async function syncAndPersistOutcome(sale: SaleForSync): Promise<KickioSyncOutcome> {
  try {
    const outcome = await syncSaleToKickio(sale);
    if (outcome.success) {
      await pool.query(
        `UPDATE sales SET kickio_synced_at = now(), kickio_product_id = $2, kickio_sale_id = $3,
           kickio_sync_action = $4, kickio_sync_error = NULL WHERE id = $1`,
        [sale.id, outcome.productId ?? null, outcome.saleId ?? null, outcome.action ?? null],
      );
    } else {
      await pool.query(
        `UPDATE sales SET kickio_sync_attempts = kickio_sync_attempts + 1, kickio_sync_error = $2 WHERE id = $1`,
        [sale.id, outcome.error ?? 'unknown error'],
      );
    }
    return outcome;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await pool.query(
      `UPDATE sales SET kickio_sync_attempts = kickio_sync_attempts + 1, kickio_sync_error = $2 WHERE id = $1`,
      [sale.id, message],
    );
    console.error(`[kickioSync] sale ${sale.id} sync threw:`, message);
    return { success: false, error: message };
  }
}
