-- Tracks whether each recorded sale has been pushed to Kickio's own
-- import_kickio_product/import_kickio_sale RPCs (services/kickioSync.ts,
-- workers/kickioSyncWorker.ts) - an hourly job, same pattern as
-- scheduleRecheck. kickio_product_id/kickio_sale_id record what Kickio
-- itself reported back (for admin visibility/debugging - never written to
-- Kickio, only read from its response), kickio_sync_action records which
-- of Kickio's own outcomes it was ('insert', 'duplicate', 'insert-orphan',
-- 'merge' for the product call). Attempts/error mirror crawl_frontier's
-- own retry-with-backoff shape (013_crawl_frontier_retry.sql) - a
-- transient failure (Kickio momentarily down, a network blip) gets a
-- bounded number of retries on the next hourly run rather than either
-- being retried forever or silently dropped after the first failure.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS kickio_synced_at timestamptz;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS kickio_sync_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS kickio_sync_error text;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS kickio_product_id uuid;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS kickio_sale_id uuid;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS kickio_sync_action text;

CREATE INDEX IF NOT EXISTS idx_sales_kickio_unsynced ON sales(kickio_synced_at) WHERE kickio_synced_at IS NULL;

ALTER TABLE jobs DROP CONSTRAINT jobs_type_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_type_check
  CHECK (type IN ('scrape', 'map', 'crawl', 'extract', 'recheck', 'kickio_sync'));
