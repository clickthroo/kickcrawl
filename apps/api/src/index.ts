import { config } from './config.js';
import { pool } from './db.js';
import { runMigrations } from './lib/migrate.js';
import { deduplicateQueuedCrawls, recoverOrphanedJobs } from './lib/jobRecords.js';
import { buildApp } from './app.js';
import { startCrawlWorker } from './workers/crawlWorker.js';

async function bootstrapAdminUser(): Promise<void> {
  if (!config.adminEmail || !config.adminPasswordHash) return;
  const { rows } = await pool.query('SELECT id FROM admin_users LIMIT 1');
  if (rows.length > 0) return;

  await pool.query(
    'INSERT INTO admin_users (email, password_hash) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING',
    [config.adminEmail, config.adminPasswordHash],
  );
  console.log(`[bootstrap] admin user ready: ${config.adminEmail}`);
}

async function main(): Promise<void> {
  await runMigrations(pool);
  await bootstrapAdminUser();

  const recovered = await recoverOrphanedJobs();
  if (recovered > 0) {
    console.log(`[recovery] marked ${recovered} orphaned job(s) as failed`);
  }

  const deduplicated = await deduplicateQueuedCrawls();
  if (deduplicated > 0) {
    console.log(`[recovery] marked ${deduplicated} duplicate queued crawl(s) as failed`);
  }

  const worker = startCrawlWorker();
  const app = await buildApp();

  await app.listen({ host: '0.0.0.0', port: config.port });
  console.log(`[kickcrawl] listening on :${config.port}`);

  const shutdown = async (): Promise<void> => {
    await app.close();
    await worker.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
