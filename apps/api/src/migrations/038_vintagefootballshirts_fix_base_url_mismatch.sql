-- Root cause of the Oct 29 production crash (Railway OOM, repeated across
-- every restart): 036 and 037 both targeted base_url =
-- 'https://vintagefootballshirts.com' (no "www."), but every real URL this
-- site is actually crawled under - every fixture/test in this repo, every
-- production comment elsewhere in the codebase, and the deploy logs from
-- the crash itself ("[fetcher] browser-rendered
-- https://www.vintagefootballshirts.com/...") - is on the www subdomain.
-- That mismatch meant both UPDATEs silently matched zero rows: the site
-- kept running with max_depth=5 and use_browser_default=true exactly as
-- before, so the frontier bloat and shared-browser-slot contention 036/037
-- were meant to fix never actually went away, and the crawl OOM'd the
-- process on every single restart (confirmed via Railway deploy logs:
-- "FATAL ERROR: Reached heap limit ... JavaScript heap out of memory" with
-- 3 concurrent crawl jobs - this site, Football Finery, The Soccer Archive
-- - all pushing process heap past 600-700MB).
--
-- Matches both the broken (no-www) and intended (www) forms so this is a
-- no-op if the base_url ever turns out to already be correct.
UPDATE sites
SET max_depth = 3,
    use_browser_default = false
WHERE base_url IN ('https://vintagefootballshirts.com', 'https://www.vintagefootballshirts.com');
