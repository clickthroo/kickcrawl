-- recheckSite()'s own eligibility query (workers/recheckWorker.ts) runs
-- once per site, every single hourly cycle, forever - it's the very first
-- thing the whole recheck pipeline (including the sitemap-lastmod skip
-- added in the previous migration) depends on. Its exact filter is
-- site_id = $1 AND stock_status IS NOT NULL AND stock_status != 'Out of
-- Stock' AND (status = 'fetched' OR status = 'failed'), but nothing
-- existing covers that combination: idx_urls_site_status(site_id, status)
-- narrows by site_id and status, and idx_urls_stock_status(stock_status)
-- covers stock_status alone, but neither lets Postgres seek straight to
-- "this site's recheck-eligible rows" in one index lookup - it still has
-- to fall back to a heap filter for whichever condition the chosen index
-- didn't cover.
--
-- A partial index scoped to exactly this query's own stock_status
-- condition (rather than an unconditional one on all four columns) stays
-- small - it only ever indexes rows that could possibly be recheck-
-- eligible in the first place, never the already-sold or never-profiled
-- majority - and lets site_id + status be looked up directly within that
-- narrower set. last_fetched_at is included last so the same index also
-- covers the status='failed' backoff comparison without a separate scan.
CREATE INDEX IF NOT EXISTS idx_urls_recheck_eligible
  ON urls(site_id, status, last_fetched_at)
  WHERE stock_status IS NOT NULL AND stock_status != 'Out of Stock';
