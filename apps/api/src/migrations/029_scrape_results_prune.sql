ALTER TABLE jobs DROP CONSTRAINT jobs_type_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_type_check
  CHECK (type IN ('scrape', 'map', 'crawl', 'extract', 'recheck', 'kickio_sync', 'kickio_listing_sync', 'player_name_backfill', 'scrape_results_prune'));

-- Supports the prune's time-window filter (lib/pruneScrapeResults.ts) -
-- without this, "every row older than N days" is a full table scan once
-- scrape_results has millions of rows, on a table that's already the
-- single biggest disk consumer in the database (confirmed in production:
-- unbounded growth here filled the entire Postgres volume - see the
-- 2026-10 disk-full incident).
CREATE INDEX IF NOT EXISTS idx_scrape_results_fetched_at ON scrape_results(fetched_at);
