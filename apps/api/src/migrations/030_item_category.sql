-- Persists category (services/kickioProfile.ts's KickioProfile.category -
-- Football Shirts, Polo Shirts & T-shirts, Jackets/Coats, ...) as a real
-- `urls` column, same reasoning as migration 010's other profile columns:
-- lets the admin Items list filter/paginate on it in SQL instead of
-- building a profile for every row on every request. Previously category
-- was only ever derived on the fly, never stored anywhere on the item
-- itself - sales/price_changes already carry it inside their own `profile`
-- JSONB snapshot (migration 008/011), which this doesn't touch.
ALTER TABLE urls ADD COLUMN IF NOT EXISTS category text;

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_urls_category_trgm ON urls USING gin (category gin_trgm_ops);

-- One-off backfill (lib/backfillCategories.ts / workers/categoryBackfillWorker.ts)
-- for every already-fetched row, which has nothing in this brand new
-- column yet regardless of whether its other profile columns are already
-- populated - unlike backfillItemProfiles.ts's own startup sweep, which
-- only ever picks up a row where EVERY profile column is still null.
ALTER TABLE jobs DROP CONSTRAINT jobs_type_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_type_check
  CHECK (type IN ('scrape', 'map', 'crawl', 'extract', 'recheck', 'kickio_sync', 'kickio_listing_sync', 'player_name_backfill', 'scrape_results_prune', 'category_backfill'));
