-- Opt-in gate for the new "list on Kickio while still active" pipeline
-- (import_kickio_listing/delist_kickio_listing, added to Kickio's own
-- database this session specifically for this) - a site's active
-- inventory is only ever submitted to Kickio's live Review Queue when
-- this is explicitly true, never automatically for every tracked site.
-- Defaults false everywhere; enabled per-site from the admin UI once
-- someone's actually decided that site's items should go there.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS list_on_kickio boolean NOT NULL DEFAULT false;

-- Per-item Kickio LISTING sync state - the same shape as sales' own
-- kickio_synced_at/kickio_sync_attempts/kickio_sync_error columns
-- (014_kickio_sync.sql), just tracking a still-active item's listing
-- instead of a completed sale. kickio_listing_sync_attempts only gates
-- the FIRST-ever successful submission (mirrors MAX_SYNC_ATTEMPTS) -
-- once kickio_listing_synced_at is set, ongoing re-submissions (to keep
-- price/condition/etc current, since import_kickio_listing is
-- idempotent per source_url and self-reports whether anything actually
-- changed) are never capped, since the whole point is perpetual tracking
-- for as long as the item stays listed. kickio_delisted_at is set once
-- delist_kickio_listing succeeds after the item's own stock_status
-- leaves 'In Stock' - reuses kickio_listing_sync_error for a failed
-- delist attempt too rather than adding a second error column, since
-- only one of "needs listing" or "needs delisting" is ever true for a
-- given item at a time.
ALTER TABLE urls ADD COLUMN IF NOT EXISTS kickio_listing_id uuid;
ALTER TABLE urls ADD COLUMN IF NOT EXISTS kickio_listing_synced_at timestamptz;
ALTER TABLE urls ADD COLUMN IF NOT EXISTS kickio_listing_sync_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE urls ADD COLUMN IF NOT EXISTS kickio_listing_sync_error text;
ALTER TABLE urls ADD COLUMN IF NOT EXISTS kickio_listing_dismissed_at timestamptz;
ALTER TABLE urls ADD COLUMN IF NOT EXISTS kickio_delisted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_urls_kickio_listing_pending
  ON urls(kickio_listing_synced_at) WHERE kickio_listing_synced_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_urls_kickio_needs_delist
  ON urls(kickio_delisted_at) WHERE kickio_listing_synced_at IS NOT NULL AND kickio_delisted_at IS NULL;

ALTER TABLE jobs DROP CONSTRAINT jobs_type_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_type_check
  CHECK (type IN ('scrape', 'map', 'crawl', 'extract', 'recheck', 'kickio_sync', 'kickio_listing_sync'));
