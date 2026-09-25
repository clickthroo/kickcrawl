-- Doubles the default per-domain crawl/recheck rate from 1 req/s to 2.
-- Real headroom, not a guess: the fetcher already spaces requests with
-- jitter and a rotating user agent (services/rateLimiter.ts,
-- randomUserAgent()), and this ceiling was never tuned up from its
-- original 001_init.sql default - it's just never been revisited. This
-- mainly benefits the plain-HTTP sites (fetchWithHttp, no browser
-- involved): a browser-driven site's real bottleneck is the shared
-- global browser slot (services/browser.ts), not this per-domain gate,
-- since a single browser-rendered fetch already takes longer than a
-- 1-request-per-second interval on its own.
--
-- Only rows still sitting at the original default (<= 1) are raised -
-- anything already above 1 was a deliberate per-site override and is left
-- untouched, and anything below 1 was deliberately slowed down (a site
-- known to be more block-sensitive) and must stay that way.
ALTER TABLE sites ALTER COLUMN rate_limit_rps SET DEFAULT 2;

UPDATE sites SET rate_limit_rps = 2 WHERE rate_limit_rps <= 1;
