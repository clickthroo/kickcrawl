import { pool } from '../db.js';

/** Admin-maintained currency code -> GBP conversion rate, for buildKickioProfile()'s price conversion. */
export async function getCurrencyRates(): Promise<Record<string, number>> {
  const { rows } = await pool.query<{ code: string; rate_to_gbp: number }>(
    'SELECT code, rate_to_gbp FROM currency_rates',
  );
  return Object.fromEntries(rows.map((r) => [r.code, r.rate_to_gbp]));
}
