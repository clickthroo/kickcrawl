-- Confirmed in production on VFS: 75% of already-discovered product urls
-- (5384 of 7200) ended up permanently status='failed' and never retried,
-- almost all from browser-crash/launch-failure errors - crawl_frontier
-- marks a row 'done' the moment it's dequeued, before the fetch even
-- happens, so a single transient failure (the shared browser instance
-- crashing, which the fetcher itself already knows how to recover from
-- for the NEXT page) permanently threw the page away. `attempts` tracks
-- how many tries a row has had; `available_at` lets a retry defer to the
-- back of the queue (ordered by available_at, not just id) instead of
-- being retried immediately next - by the time it comes back around,
-- there have been many other fetches in between, giving a crashed
-- browser real time to recycle rather than getting hit again right away.
ALTER TABLE crawl_frontier ADD COLUMN attempts integer NOT NULL DEFAULT 0;
ALTER TABLE crawl_frontier ADD COLUMN available_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_crawl_frontier_job_status_available
  ON crawl_frontier(job_id, status, available_at);
