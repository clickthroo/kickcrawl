import { pool } from '../db.js';
import type { KickioProfile } from '../services/kickioProfile.js';

/**
 * The subset of a KickioProfile's fields that are also persisted as real
 * `urls` columns (see migrations 010 and 011), specifically so the admin
 * Items list can filter/paginate them in SQL instead of building a profile
 * for every row in the table on every request (routes/admin/urls.ts), and
 * so a recheck has a stored price to diff a fresh read against to detect a
 * real price change (workers/recheckWorker.ts), the same way it already
 * diffs stock_status to detect a sale.
 */
export interface ItemProfileColumns {
  stock_status: string | null;
  team: string | null;
  season: string | null;
  shirt_type: string | null;
  player: string | null;
  player_number: string | null;
  colour: string | null;
  colour_secondary: string | null;
  size: string | null;
  manufacturer: string | null;
  condition: string | null;
  price: number | null;
  currency: string | null;
}

export function profileToColumns(profile: KickioProfile): ItemProfileColumns {
  return {
    stock_status: profile.listing.stock_status,
    team: profile.identity.team,
    season: profile.identity.season,
    shirt_type: profile.identity.shirt_type,
    player: profile.identity.player,
    player_number: profile.identity.number,
    colour: profile.listing.colour,
    colour_secondary: profile.listing.colour_secondary,
    size: profile.listing.size,
    manufacturer: profile.listing.manufacturer,
    condition: profile.listing.condition,
    price: profile.listing.price,
    currency: profile.listing.currency,
  };
}

export async function persistItemProfileColumns(urlId: string, profile: KickioProfile): Promise<void> {
  const c = profileToColumns(profile);
  await pool.query(
    `UPDATE urls SET
       stock_status = $2, team = $3, season = $4, shirt_type = $5,
       player = $6, player_number = $7, colour = $8, colour_secondary = $9,
       size = $10, manufacturer = $11, condition = $12, price = $13, currency = $14
     WHERE id = $1`,
    [
      urlId,
      c.stock_status,
      c.team,
      c.season,
      c.shirt_type,
      c.player,
      c.player_number,
      c.colour,
      c.colour_secondary,
      c.size,
      c.manufacturer,
      c.condition,
      c.price,
      c.currency,
    ],
  );
}
