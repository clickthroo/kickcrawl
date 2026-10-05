ALTER TABLE jobs DROP CONSTRAINT jobs_type_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_type_check
  CHECK (type IN ('scrape', 'map', 'crawl', 'extract', 'recheck', 'kickio_sync', 'kickio_listing_sync', 'player_name_backfill'));
