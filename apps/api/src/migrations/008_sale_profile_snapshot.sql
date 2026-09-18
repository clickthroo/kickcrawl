-- Sales previously only snapshotted title/price/currency - every other
-- feature (team, season, type, condition, images, etc) was left to a join
-- back to urls/scrape_results, which is exactly what 005_stock_tracking.sql
-- says a sale record should NOT depend on (the source page can later
-- change, go out of stock differently, or 404). Snapshotting the full
-- Kickio profile at detection time - the same one already built for the
-- items list - keeps a sale's record of what was sold accurate forever,
-- independent of what happens to the source page afterwards.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS profile jsonb;
