import { pool } from '../db.js';
import { buildKickioProfile } from '../services/kickioProfile.js';
import { getCurrencyRates } from './currencyRates.js';
import { getKickioTeamsForMatching } from './kickioTeams.js';
import { persistItemProfileColumns } from './persistItemProfile.js';

/**
 * One-off, admin-triggered backfill for urls rows that predate migration
 * 030's `category` column - every row fetched before that migration has
 * category = null regardless of whether its other profile columns (team,
 * season, ...) are already populated, so this can't reuse
 * backfillItemProfiles.ts's own startup sweep (which only ever picks up a
 * row where EVERY profile column is still null - true for a genuinely
 * unprofiled legacy row, not true for most of this table). Scoped to
 * `category IS NULL` alone, re-deriving and persisting the full profile
 * (same as backfillPlayerNames.ts) rather than just the one column, so a
 * row's other columns also pick up any mapping fix made since it was last
 * profiled. Safe to re-run: a row this already updated no longer matches
 * the WHERE clause.
 */
const BATCH_SIZE = 500;

export async function backfillItemCategories(
  onProgress?: (done: number, total: number) => Promise<void> | void,
): Promise<number> {
  const { rows: targets } = await pool.query<{ id: string }>(
    `SELECT id FROM urls WHERE status = 'fetched' AND category IS NULL`,
  );
  if (targets.length === 0) return 0;

  const currencyRates = await getCurrencyRates();
  const kickioTeams = await getKickioTeamsForMatching();

  let totalUpdated = 0;
  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batchIds = targets.slice(i, i + BATCH_SIZE).map((t) => t.id);
    const { rows } = await pool.query<{
      id: string;
      url: string;
      last_fetched_at: string | null;
      title: string | null;
      image: string | null;
      images: string[] | null;
      extracted: Record<string, string> | null;
      markdown: string | null;
    }>(
      `SELECT u.id, u.url, u.last_fetched_at,
              m.content->>'title' AS title, m.content->>'image' AS image,
              m.content->'images' AS images,
              e.content AS extracted, md.content AS markdown
       FROM urls u
       LEFT JOIN LATERAL (
         SELECT content FROM scrape_results sr
         WHERE sr.url_id = u.id AND sr.format = 'metadata'
         ORDER BY sr.fetched_at DESC LIMIT 1
       ) m ON true
       LEFT JOIN LATERAL (
         SELECT content FROM scrape_results sr
         WHERE sr.url_id = u.id AND sr.format = 'extracted'
         ORDER BY sr.fetched_at DESC LIMIT 1
       ) e ON true
       LEFT JOIN LATERAL (
         SELECT content FROM scrape_results sr
         WHERE sr.url_id = u.id AND sr.format = 'markdown'
         ORDER BY sr.fetched_at DESC LIMIT 1
       ) md ON true
       WHERE u.id = ANY($1::uuid[])`,
      [batchIds],
    );

    for (const row of rows) {
      const profile = buildKickioProfile({
        url: row.url,
        title: row.title,
        description: row.markdown?.slice(0, 4000) ?? null,
        images: row.images ?? (row.image ? [row.image] : []),
        extracted: row.extracted,
        scrapedAt: row.last_fetched_at ?? undefined,
        currencyRates,
        kickioTeams,
      });
      await persistItemProfileColumns(row.id, profile);
      totalUpdated += 1;
      if (onProgress) await onProgress(totalUpdated, targets.length);
    }
    console.log(`[backfillItemCategories] updated ${totalUpdated}/${targets.length} rows so far`);
  }

  return totalUpdated;
}
