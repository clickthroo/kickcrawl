import { Worker } from 'bullmq';
import { redisConnection, kickioListingSyncQueue } from '../queue.js';
import { pool } from '../db.js';
import { createJob, failJob } from '../lib/jobRecords.js';
import { isKickioSyncConfigured } from '../lib/kickioSync.js';
import {
  syncListingAndPersistOutcome,
  delistAndPersistOutcome,
  MAX_LISTING_SYNC_ATTEMPTS,
} from '../lib/kickioListingSync.js';
import { buildKickioProfile } from '../services/kickioProfile.js';
import { getCurrencyRates } from '../lib/currencyRates.js';
import { getKickioTeamsForMatching } from '../lib/kickioTeams.js';

export const KICKIO_LISTING_SYNC_INTERVAL_MS = 60 * 60 * 1000;

interface Progress {
  listed: number;
  listedFailed: number;
  delisted: number;
  delistFailed: number;
  errors: string[];
}

/**
 * The hourly sweep behind the "list on discovery, keep price current,
 * delist on sale" pipeline (session history - built once Kickio added
 * import_kickio_listing/delist_kickio_listing specifically for this).
 * Two independent passes:
 *
 * 1. List/refresh: every In Stock item on an opted-in site
 *    (sites.list_on_kickio) gets (re-)submitted every run. Not gated on
 *    "did anything actually change" - import_kickio_listing is
 *    idempotent per source_url and self-reports whether the price
 *    changed, so re-submitting an unchanged listing is a safe, cheap
 *    no-op on Kickio's side. Only a row that's NEVER yet succeeded is
 *    bounded by MAX_LISTING_SYNC_ATTEMPTS (see that constant's own
 *    comment) - once listed, an item keeps getting refreshed every hour
 *    for as long as it stays In Stock and opted in, with no cap.
 * 2. Delist: any item that WAS successfully listed and has since gone
 *    Out of Stock (kickcrawl's own recheck already caught the sale - see
 *    lib/saleDetection.ts) gets pulled from Kickio. Deliberately not
 *    gated on the site's CURRENT list_on_kickio value - a listing
 *    already live on Kickio still needs to come down if sold, even if
 *    the site's opt-in was switched off in the meantime.
 */
export async function processKickioListingSync(): Promise<void> {
  const jobId = await createJob('kickio_listing_sync', null, {}, 'running');
  const progress: Progress = { listed: 0, listedFailed: 0, delisted: 0, delistFailed: 0, errors: [] };

  try {
    if (!isKickioSyncConfigured()) {
      await pool.query(`UPDATE jobs SET status = 'completed', finished_at = now() WHERE id = $1`, [jobId]);
      console.log(`[kickioListingSyncWorker] job ${jobId} skipped - KICKIO_SUPABASE_SERVICE_ROLE_KEY not configured`);
      return;
    }

    const { rows: toList } = await pool.query(
      `SELECT u.id, u.url, u.last_fetched_at,
              m.content->>'title' AS preview_title, m.content->>'image' AS preview_image,
              m.content->'images' AS preview_images,
              e.content AS preview_extracted, md.content AS preview_markdown
       FROM urls u
       JOIN sites s ON s.id = u.site_id
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
       WHERE s.list_on_kickio = true
         AND u.stock_status = 'In Stock'
         AND u.kickio_listing_dismissed_at IS NULL
         AND (u.kickio_listing_synced_at IS NOT NULL OR u.kickio_listing_sync_attempts < $1)`,
      [MAX_LISTING_SYNC_ATTEMPTS],
    );

    const { rows: toDelist } = await pool.query(
      `SELECT u.id, u.url FROM urls u
       WHERE u.kickio_listing_synced_at IS NOT NULL
         AND u.kickio_delisted_at IS NULL
         AND u.stock_status = 'Out of Stock'`,
    );

    await pool.query(`UPDATE jobs SET total_pages = $2 WHERE id = $1`, [jobId, toList.length + toDelist.length]);
    let completed = 0;

    if (toList.length > 0) {
      const currencyRates = await getCurrencyRates();
      const kickioTeams = await getKickioTeamsForMatching();

      for (const row of toList) {
        if (row.preview_title || row.preview_extracted || row.preview_markdown) {
          const profile = buildKickioProfile({
            url: row.url,
            title: row.preview_title,
            description: row.preview_markdown?.slice(0, 4000) ?? null,
            images: row.preview_images ?? [row.preview_image],
            extracted: row.preview_extracted,
            scrapedAt: row.last_fetched_at,
            currencyRates,
            kickioTeams,
          });
          const outcome = await syncListingAndPersistOutcome(row.id, profile);
          if (outcome.success) {
            progress.listed += 1;
          } else {
            progress.listedFailed += 1;
            progress.errors.push(`list ${row.id}: ${outcome.error ?? 'unknown error'}`);
          }
        } else {
          progress.listedFailed += 1;
          progress.errors.push(`list ${row.id}: nothing scraped yet`);
        }
        completed += 1;
        await pool.query(`UPDATE jobs SET completed_pages = $2 WHERE id = $1`, [jobId, completed]);
      }
    }

    for (const row of toDelist) {
      const outcome = await delistAndPersistOutcome(row.id, row.url);
      if (outcome.success) {
        progress.delisted += 1;
      } else {
        progress.delistFailed += 1;
        progress.errors.push(`delist ${row.id}: ${outcome.error ?? 'unknown error'}`);
      }
      completed += 1;
      await pool.query(`UPDATE jobs SET completed_pages = $2 WHERE id = $1`, [jobId, completed]);
    }

    await pool.query(
      `UPDATE jobs SET status = 'completed', completed_pages = $2,
         error_count = $3, errors = $4::jsonb, finished_at = now() WHERE id = $1`,
      [jobId, completed, progress.errors.length, JSON.stringify(progress.errors.map((e) => ({ message: e })))],
    );
    console.log(
      `[kickioListingSyncWorker] job ${jobId} listed ${progress.listed} (${progress.listedFailed} held), ` +
        `delisted ${progress.delisted} (${progress.delistFailed} failed)`,
    );
  } catch (err) {
    await failJob(jobId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

export function startKickioListingSyncWorker(): Worker {
  const worker = new Worker(
    'kickio_listing_sync',
    async () => {
      await processKickioListingSync();
    },
    {
      connection: redisConnection,
      concurrency: 1,
      maxStalledCount: 0,
      // Generous for the same reason as kickioSyncWorker.ts's own lock -
      // this sweep can touch every opted-in site's whole active
      // inventory every hour, each row its own Kickio RPC call.
      lockDuration: 10 * 60_000,
    },
  );
  worker.on('failed', (job, err) => {
    console.error(`[kickioListingSyncWorker] job ${job?.id} failed:`, err);
  });
  return worker;
}

/**
 * Registers the repeatable job - same dedup-by-removing-and-re-adding
 * pattern as kickioSyncWorker.ts's own scheduleKickioSync.
 */
export async function scheduleKickioListingSync(): Promise<void> {
  const existing = await kickioListingSyncQueue.getRepeatableJobs();
  for (const job of existing) {
    if (job.name === 'kickio_listing_sync') {
      await kickioListingSyncQueue.removeRepeatableByKey(job.key);
    }
  }
  await kickioListingSyncQueue.add('kickio_listing_sync', {}, { repeat: { every: KICKIO_LISTING_SYNC_INTERVAL_MS } });
}
