import { config } from '../config.js';
import type { KickioProfile } from '../services/kickioProfile.js';

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

async function callKickioRpc<T>(fn: string, payload: Record<string, unknown>): Promise<T> {
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

/**
 * Builds the payload for both Kickio RPCs from a stored sale row - team
 * comes from identity.team_kickio_match, never the raw identity.team
 * guess, per the already-decided write-integration policy (kickioProfile.ts
 * KickioProfile.identity.team_kickio_match's own doc comment): Kickio's
 * live product catalog should only ever be written to with a verified
 * team match, never a scraped guess, on pain of polluting it with wrong
 * or duplicate teams that are hard to clean up later. Returns null (not
 * an error - a deliberate hold) when the sale isn't safe to send yet.
 */
function buildPayloads(
  sale: SaleForSync,
): { product: Record<string, unknown>; sale: Record<string, unknown> } | { hold: string } {
  const profile = sale.profile;
  if (!profile) return { hold: 'no stored profile snapshot on this sale' };

  const team = profile.identity.team_kickio_match;
  if (!team) return { hold: 'no confident Kickio team match - held for review, never sent as a guess' };

  if (sale.price == null) return { hold: 'no price recorded for this sale' };

  const identity = {
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

  const product = {
    id: sale.url_id,
    ...identity,
    player: profile.identity.player,
    number: profile.identity.number,
    colour: profile.listing.colour,
    image_url: profile.listing.images[0] ?? null,
    extra_seasons: profile.identity.extra_seasons,
  };

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
