import { pool } from '../db.js';

export type JobType = 'scrape' | 'map' | 'crawl' | 'extract';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export async function createJob(
  type: JobType,
  siteId: string | null,
  payload: unknown,
  status: JobStatus = 'queued',
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO jobs (type, site_id, payload, status, started_at)
     VALUES ($1, $2, $3, $4, CASE WHEN $4 IN ('running','completed') THEN now() ELSE NULL END)
     RETURNING id`,
    [type, siteId, JSON.stringify(payload), status],
  );
  return rows[0].id;
}

export async function completeJob(
  jobId: string,
  totalPages: number,
  completedPages: number,
): Promise<void> {
  await pool.query(
    `UPDATE jobs SET status = 'completed', total_pages = $2, completed_pages = $3, finished_at = now() WHERE id = $1`,
    [jobId, totalPages, completedPages],
  );
}

export async function failJob(jobId: string, error: string): Promise<void> {
  await pool.query(
    `UPDATE jobs SET status = 'failed', error_count = error_count + 1,
       errors = errors || $2::jsonb, finished_at = now() WHERE id = $1`,
    [jobId, JSON.stringify([{ message: error, at: new Date().toISOString() }])],
  );
}
