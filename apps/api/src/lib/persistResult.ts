import { pool } from '../db.js';
import type { ScrapeCoreResult } from './scrapeCore.js';

/**
 * Persists every part of a scrape result available so far - metadata
 * (title/description/image, for human-friendly previews in the admin UI),
 * markdown, and selector-extracted fields - each as its own scrape_results
 * row, tied to the URL and (optionally) the job that produced it.
 */
export async function persistScrapeResult(
  urlId: string,
  jobId: string | null,
  result: ScrapeCoreResult,
): Promise<void> {
  const statusCode = result.metadata.statusCode;
  const inserts: Promise<unknown>[] = [
    pool.query(
      `INSERT INTO scrape_results (url_id, job_id, format, content, status_code) VALUES ($1, $2, 'metadata', $3, $4)`,
      [
        urlId,
        jobId,
        JSON.stringify({
          title: result.metadata.title,
          description: result.metadata.description,
          image: result.metadata.image,
        }),
        statusCode,
      ],
    ),
  ];

  if (result.markdown !== undefined) {
    inserts.push(
      pool.query(
        `INSERT INTO scrape_results (url_id, job_id, format, content, status_code) VALUES ($1, $2, 'markdown', $3, $4)`,
        [urlId, jobId, JSON.stringify(result.markdown), statusCode],
      ),
    );
  }

  if (result.extracted !== undefined) {
    inserts.push(
      pool.query(
        `INSERT INTO scrape_results (url_id, job_id, format, content, status_code) VALUES ($1, $2, 'extracted', $3, $4)`,
        [urlId, jobId, JSON.stringify(result.extracted), statusCode],
      ),
    );
  }

  await Promise.all(inserts);
}
