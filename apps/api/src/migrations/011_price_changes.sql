-- Persists the last-known price/currency per URL, so a scheduled recheck
-- can diff a fresh read against it to detect a real price change - mirrors
-- migration 005's stock_status column and the same reasoning (previously
-- only ever computed on the fly, never stored, so there was nothing to
-- diff against).
ALTER TABLE urls ADD COLUMN IF NOT EXISTS price numeric;
ALTER TABLE urls ADD COLUMN IF NOT EXISTS currency text;

-- One row per detected price change (workers/recheckWorker.ts - the same
-- "In Stock -> Out of Stock" recheck-time diff that already detects a
-- sale, but for price instead of stock status). Snapshots the full Kickio
-- profile at detection time, same reasoning as sales
-- (008_sale_profile_snapshot.sql): the source page can change or 404
-- later, so a price-change record shouldn't depend on joining back to it.
CREATE TABLE IF NOT EXISTS price_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url_id uuid NOT NULL REFERENCES urls(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  title text,
  old_price numeric NOT NULL,
  new_price numeric NOT NULL,
  currency text,
  profile jsonb,
  detected_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_changes_site_detected ON price_changes(site_id, detected_at);
