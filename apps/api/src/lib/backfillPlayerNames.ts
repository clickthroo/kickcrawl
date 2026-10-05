import { pool } from '../db.js';
import { buildKickioProfile } from '../services/kickioProfile.js';
import { getCurrencyRates } from './currencyRates.js';
import { getKickioTeamsForMatching } from './kickioTeams.js';
import { persistItemProfileColumns } from './persistItemProfile.js';

/**
 * One-off, admin-triggered backfill for urls rows caught by a real bug in
 * guessTeamFromTitle's #-marked player-tag stripping (services/
 * kickioProfile.ts): a bare initial ("P." - a capital letter plus a
 * period, no lowercase letters) wasn't recognised as part of a player's
 * name, so it stayed in the team guess, which then - via
 * normalizePlayerName's own team-token stripping - wiped an otherwise
 * correctly-extracted player name down to null too (confirmed on a real
 * footballfinery.co.uk listing, "...#11 P. Coutinho"). Not scoped to that
 * one site: the underlying regex gap was general, not site-specific, so
 * any other site hit by the exact same shape is caught by this same
 * symptom query.
 *
 * Scoped to the bug's own symptom (a marked shirt number was found, but
 * the player name came back null) rather than re-running every row in the
 * table - deliberately NOT the same "query again each loop iteration"
 * pattern backfillItemProfiles.ts uses, since that pattern relies on a
 * processed row reliably dropping out of its own WHERE clause (there,
 * because a dozen other columns also get filled in alongside it). This
 * symptom has no such guarantee - a genuinely blank/number-only shirt
 * (e.g. an unqualified "#1 M" goalkeeper shirt) will legitimately still
 * have player = null after being correctly reprocessed, so re-querying
 * the same WHERE clause on every iteration would loop forever on exactly
 * those rows. Fetches the full set of matching ids ONCE up front instead,
 * then works through that fixed list exactly once each - reprocessing a
 * row that turns out to be legitimately player-less is harmless (the same
 * null result, just re-derived), matching every other backfill in this
 * file's own "safe to re-run" philosophy.
 */
const BATCH_SIZE = 500;

export async function backfillBareInitialPlayerNames(
  onProgress?: (done: number, total: number) => Promise<void> | void,
): Promise<number> {
  const { rows: targets } = await pool.query<{ id: string }>(
    `SELECT id FROM urls WHERE status = 'fetched' AND player_number IS NOT NULL AND player IS NULL`,
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
    console.log(`[backfillBareInitialPlayerNames] updated ${totalUpdated}/${targets.length} rows so far`);
  }

  return totalUpdated;
}
