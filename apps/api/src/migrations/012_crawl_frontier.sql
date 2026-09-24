-- Persists a crawl job's own BFS traversal queue, which previously lived
-- only as an in-memory array/Set inside processCrawl (crawlWorker.ts) -
-- lost the instant the process restarted (a deploy, a crash), which is
-- why recoverOrphanedJobs() (jobRecords.ts) had no choice but to
-- permanently fail any job still 'running'/'paused' at boot. Every
-- discovered URL for a job gets exactly one row here, moving
-- 'pending' -> 'done' as it's dequeued and processed; the unique
-- constraint on (job_id, url) is what makes re-discovering the same URL
-- from a different page a safe no-op, the same guarantee the in-memory
-- visited Set used to provide.
CREATE TABLE IF NOT EXISTS crawl_frontier (
  id bigserial PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  url text NOT NULL,
  depth integer NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, url)
);

CREATE INDEX IF NOT EXISTS idx_crawl_frontier_job_status ON crawl_frontier(job_id, status, id);
