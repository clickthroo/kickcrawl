-- Loosens footballfinery.co.uk's crawl settings (026) now that they're
-- actually confirmed, not just a cautious guess: the user checked
-- view-source on a real product page and found a complete schema.org
-- Product JSON-LD block (price, sku, currency, availability, gtin,
-- offers) already present in the raw HTML, with no JS execution at all -
-- the same evidence Casual Football Shirts (019) was onboarded on.
--
-- A real crawl against the old settings (browser on, rate_limit_rps 1)
-- surfaced why this mattered beyond just "slower than necessary": browser-
-- rendered fetches share a hard app-wide cap of only 2 concurrent slots
-- (services/browser.ts's MAX_CONCURRENT_BROWSER_FETCHES, a deliberate
-- memory-safety limit after a real production OOM crash) across EVERY
-- job that needs one - this site's own crawl, the hourly recheck sweep on
-- every other site, anything else browser-driven running at the same
-- time. Combined with the crawl loop's strictly sequential per-page
-- fetching and a 6555-page catalog, that was on track to take several
-- hours for one crawl. Turning browser rendering off removes this site
-- entirely from that shared bottleneck, not just skips its own per-page
-- render cost.
--
--   * use_browser_default = false, skip_browser_for_items = false (to
--     match, since the browser is never turned on for this site in the
--     first place) - mirrors Casual Football Shirts' exact reasoning.
--   * rate_limit_rps raised from 1 to 2 - the sitewide default
--     (015_raise_default_rate_limit.sql), already proven safe on two
--     other Shopify sites; nothing in the real crawl so far (0 errors
--     across every page fetched) suggested this site is more
--     block-sensitive than that.
--   * max_depth raised from 2 to 3 - mirrors every other multi-level
--     catalog site (home -> collections -> products, with headroom for
--     pagination), now that there's no reason left to stay unusually
--     conservative here.
UPDATE sites
SET use_browser_default = false,
    skip_browser_for_items = false,
    rate_limit_rps = 2,
    max_depth = 3
WHERE base_url = 'https://www.footballfinery.co.uk';
