-- Per-site seller-trust filters for marketplaces where a listing's own
-- seller matters (Vinted's Pro badge + feedback count) - a crawl skips
-- recording an item that doesn't pass these, once its content has
-- actually been fetched (services/sellerSignals.ts reads them from the
-- page's own rendered text, not a separate lookup).
ALTER TABLE sites ADD COLUMN IF NOT EXISTS require_pro_seller boolean NOT NULL DEFAULT false;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS min_seller_feedback integer;
