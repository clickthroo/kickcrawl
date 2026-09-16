-- Persists the last-known stock status per URL, so a scheduled recheck can
-- diff a fresh read against it to detect an In Stock -> Out of Stock
-- transition (a "sale"). Previously this was only ever computed on the fly
-- (kickioProfile.ts's detectStockStatus), never stored, so there was
-- nothing to diff against.
ALTER TABLE urls ADD COLUMN IF NOT EXISTS stock_status text
  CHECK (stock_status IN ('In Stock', 'Out of Stock', 'Unknown'));

-- One row per detected sale. Snapshots title/price/currency at the moment
-- of detection rather than joining back to urls/scrape_results for them,
-- since the source page can later change, go out of stock differently, or
-- 404 - a sale record should stay accurate to what was actually sold.
CREATE TABLE IF NOT EXISTS sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url_id uuid NOT NULL REFERENCES urls(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  title text,
  price numeric,
  currency text,
  detected_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_site_detected ON sales(site_id, detected_at);

ALTER TABLE jobs DROP CONSTRAINT jobs_type_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_type_check
  CHECK (type IN ('scrape', 'map', 'crawl', 'extract', 'recheck'));
