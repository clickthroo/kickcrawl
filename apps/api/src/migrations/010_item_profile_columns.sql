-- Persists the commonly-filtered Kickio profile fields (previously only
-- ever derived on the fly, per request, by buildKickioProfile) as real
-- columns, so the admin Items list can filter/paginate them in SQL instead
-- of scanning and profiling a capped window of the whole table on every
-- request - that scan window (2000 rows) silently hid any older item once
-- a site's total url count grew past it, with no way to raise it that
-- didn't mean profiling the entire table, synchronously, in the same
-- process that also runs the crawl/recheck workers.
ALTER TABLE urls
  ADD COLUMN IF NOT EXISTS team text,
  ADD COLUMN IF NOT EXISTS season text,
  ADD COLUMN IF NOT EXISTS shirt_type text,
  ADD COLUMN IF NOT EXISTS player text,
  ADD COLUMN IF NOT EXISTS player_number text,
  ADD COLUMN IF NOT EXISTS colour text,
  ADD COLUMN IF NOT EXISTS colour_secondary text,
  ADD COLUMN IF NOT EXISTS size text,
  ADD COLUMN IF NOT EXISTS manufacturer text,
  ADD COLUMN IF NOT EXISTS condition text;

CREATE INDEX IF NOT EXISTS idx_urls_discovered_at ON urls(discovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_urls_stock_status ON urls(stock_status);

-- pg_trgm's GIN indexes are what actually makes an ILIKE '%substring%'
-- filter (the existing behavior for team/season/etc, matching how `path`
-- is already filtered elsewhere) fast at real scale, rather than a
-- sequential scan - a plain btree index can't serve a substring match at
-- all. Needed once these fields are filtered in SQL instead of in JS.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_urls_team_trgm ON urls USING gin (team gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_urls_season_trgm ON urls USING gin (season gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_urls_shirt_type_trgm ON urls USING gin (shirt_type gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_urls_player_trgm ON urls USING gin (player gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_urls_colour_trgm ON urls USING gin (colour gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_urls_colour_secondary_trgm ON urls USING gin (colour_secondary gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_urls_size_trgm ON urls USING gin (size gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_urls_manufacturer_trgm ON urls USING gin (manufacturer gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_urls_condition_trgm ON urls USING gin (condition gin_trgm_ops);
