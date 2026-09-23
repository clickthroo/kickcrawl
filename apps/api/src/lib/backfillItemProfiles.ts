import 'dotenv/config';
import { Pool } from 'pg';
import { config } from '../config.js';
import { buildKickioProfile } from '../services/kickioProfile.js';
import { getCurrencyRates } from './currencyRates.js';
import { getKickioTeamsForMatching } from './kickioTeams.js';
import { profileToColumns } from './persistItemProfile.js';

/**
 * Backfill for `urls` rows that predate migration 010 - the profile
 * columns (team, season, colour, ...) the admin Items list now filters/
 * paginates in SQL. Every row fetched from here on already gets these
 * written at crawl/recheck time (see workers/crawlWorker.ts and
 * workers/recheckWorker.ts); this is only for what was already in the
 * table before that started. Also run automatically, once, in the
 * background on every server startup (see index.ts) - it only ever
 * touches rows still missing every profile column, so a normal boot where
 * there's nothing left to do is just an empty query and a no-op, not a
 * repeated full-table scan.
 *
 * Safe to interrupt or re-run: only rows where every profile column is
 * still null are picked up (see the WHERE clause below), so a partial run
 * just picks back up where it left off, and a row a recheck has already
 * refreshed in the meantime is left alone rather than overwritten with a
 * possibly-stale rebuild.
 */
const BATCH_SIZE = 500;

export async function backfillItemProfiles(pool: Pool): Promise<number> {
  const currencyRates = await getCurrencyRates();
  const kickioTeams = await getKickioTeamsForMatching();

  let totalUpdated = 0;
  for (;;) {
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
       WHERE u.status = 'fetched'
         AND u.team IS NULL AND u.season IS NULL AND u.shirt_type IS NULL
         AND u.player IS NULL AND u.player_number IS NULL AND u.colour IS NULL
         AND u.colour_secondary IS NULL AND u.size IS NULL
         AND u.manufacturer IS NULL AND u.condition IS NULL
         AND (m.content IS NOT NULL OR e.content IS NOT NULL OR md.content IS NOT NULL)
       ORDER BY u.discovered_at DESC
       LIMIT ${BATCH_SIZE}`,
    );
    if (rows.length === 0) break;

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
      const c = profileToColumns(profile);
      await pool.query(
        `UPDATE urls SET
           stock_status = $2, team = $3, season = $4, shirt_type = $5,
           player = $6, player_number = $7, colour = $8, colour_secondary = $9,
           size = $10, manufacturer = $11, condition = $12
         WHERE id = $1`,
        [
          row.id,
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
        ],
      );
    }
    totalUpdated += rows.length;
    console.log(`[backfillItemProfiles] updated ${totalUpdated} rows so far`);
  }

  return totalUpdated;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = new Pool({ connectionString: config.databaseUrl });
  backfillItemProfiles(pool)
    .then((total) => {
      console.log(`[backfillItemProfiles] done - ${total} rows updated`);
      return pool.end();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
