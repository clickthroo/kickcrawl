import { pool } from '../db.js';

// Normalizes a URL so the same page always maps to the same row -
// `new URL()` alone already collapses "http://host" to "http://host/",
// but callers may also pass URLs with a trailing hash from user input.
function normalizeUrl(url: string): string {
  const u = new URL(url);
  u.hash = '';
  return u.toString();
}

export async function upsertDiscoveredUrl(siteId: string, url: string): Promise<void> {
  const normalized = normalizeUrl(url);
  const path = new URL(normalized).pathname;
  await pool.query(
    `INSERT INTO urls (site_id, url, path)
     VALUES ($1, $2, $3)
     ON CONFLICT (site_id, url) DO NOTHING`,
    [siteId, normalized, path],
  );
}

export async function upsertDiscoveredUrls(siteId: string, urls: string[]): Promise<void> {
  await Promise.all(urls.map((url) => upsertDiscoveredUrl(siteId, url).catch(() => undefined)));
}

export async function markUrlFetched(
  siteId: string,
  url: string,
  statusCode: number,
  error?: string,
): Promise<string> {
  const normalized = normalizeUrl(url);
  const path = new URL(normalized).pathname;
  const status = error ? 'failed' : 'fetched';
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO urls (site_id, url, path, status, last_fetched_at, last_status_code, last_error)
     VALUES ($1, $2, $3, $4, now(), $5, $6)
     ON CONFLICT (site_id, url) DO UPDATE SET
       status = EXCLUDED.status,
       last_fetched_at = now(),
       last_status_code = EXCLUDED.last_status_code,
       last_error = EXCLUDED.last_error
     RETURNING id`,
    [siteId, normalized, path, status, statusCode, error ?? null],
  );
  return rows[0].id;
}

export async function markUrlQueued(siteId: string, url: string): Promise<void> {
  const normalized = normalizeUrl(url);
  const path = new URL(normalized).pathname;
  await pool.query(
    `INSERT INTO urls (site_id, url, path, status)
     VALUES ($1, $2, $3, 'queued')
     ON CONFLICT (site_id, url) DO UPDATE SET status = 'queued'`,
    [siteId, normalized, path],
  );
}
