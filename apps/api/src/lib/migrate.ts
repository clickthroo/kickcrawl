import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { Pool } from 'pg';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

// Convention for any migration that UPDATEs a specific row by a literal
// value (most commonly `sites` by `base_url`), rather than a blanket
// predicate meant to match zero-or-more rows: wrap it so a typo'd/wrong
// literal fails the deploy loudly instead of silently updating nothing.
// Root cause of a real production incident (038_vintagefootballshirts_
// fix_base_url_mismatch.sql): 036 and 037 both targeted
// `base_url = 'https://vintagefootballshirts.com'` (missing "www."), which
// matched zero rows - the UPDATE "succeeded" (no SQL error, nothing for
// this runner to catch) and was recorded as applied, but the config change
// it was meant to make never actually happened, and that silently shipped
// to production for a full day before it surfaced as a crash-looping OOM.
// Wrap any future single-row-by-literal UPDATE like this instead:
//
//   DO $$
//   BEGIN
//     UPDATE sites SET ... WHERE base_url = '<exact value>';
//     IF NOT FOUND THEN
//       RAISE EXCEPTION 'migration NNN: base_url not found for <site name> (<value>)';
//     END IF;
//   END $$;
//
// A RAISE EXCEPTION here rolls back this migration's own transaction (see
// runMigrations' BEGIN/COMMIT/ROLLBACK below) and fails the deploy's boot
// sequence (index.ts's main().catch) instead of recording the migration as
// applied - the same way any other SQL error in a migration already does.
// See 039_vintagefootballshirts_conservative_rate_limit.sql for a worked
// example.

export async function runMigrations(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const { rows } = await pool.query<{ name: string }>('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.name));

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    console.log(`[migrate] applying ${file}`);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  console.log('[migrate] up to date');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pool = new Pool({ connectionString: config.databaseUrl });
  runMigrations(pool)
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
