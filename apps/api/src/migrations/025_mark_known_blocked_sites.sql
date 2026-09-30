-- Tracks a site deliberately left out of the crawl rotation because it's
-- protected by anti-bot measures we've decided not to try to defeat
-- (session history - Cloudflare Turnstile / similar interactive
-- challenges; the decision was made not to build stealth-patched headless
-- browsers, residential proxy rotation, or CAPTCHA-solving to get past a
-- site's own declared "no bots" signal - that's deliberately circumventing
-- a control the site owner put there on purpose, a different thing from
-- "this site happens to need a browser to render JS", which this app
-- already handles routinely). NULL for every ordinary site. Set alongside
-- is_active = false so a known-blocked site is both excluded from "Crawl
-- all sites" AND distinguishable in the admin UI from a site that's
-- merely paused for some other reason.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS blocked_reason text;

-- classicfootballshirts.co.uk - audited live before Casual Football
-- Shirts was added (019_add_casual_football_shirts_site.sql's own
-- comment), but never itself added to this table: every page was gated
-- behind an interactive Cloudflare Turnstile challenge that neither a
-- plain HTTP fetch nor this app's own headless-Chromium setup could
-- clear. Added now (inactive, with the reason recorded) so it's visible
-- in the admin UI as "tried and found blocked", not just absent with no
-- record of why. base_url is the best-known canonical URL from that
-- original audit - never itself stored anywhere before this.
INSERT INTO sites (
  name, base_url, rate_limit_rps, max_depth, use_browser_default, skip_browser_for_items,
  use_proxy, default_selectors, allowed_paths, denied_paths, is_active,
  require_pro_seller, min_seller_feedback, blocked_reason
) VALUES (
  'Classic Football Shirts',
  'https://www.classicfootballshirts.co.uk',
  2,
  3,
  true,
  false,
  false,
  '{}',
  ARRAY[]::text[],
  ARRAY[]::text[],
  false,
  false,
  NULL,
  'Every page gated behind an interactive Cloudflare Turnstile challenge - confirmed via a live audit before Casual Football Shirts was onboarded. Neither a plain HTTP fetch nor this app''s headless-Chromium setup could clear it. Not pursuing a bypass (stealth browser patches, residential proxies, CAPTCHA-solving) - deliberately defeating a site''s own anti-bot measure, not just working around a technical limitation.'
)
ON CONFLICT (base_url) DO UPDATE SET is_active = false, blocked_reason = EXCLUDED.blocked_reason;

-- thekitman.co.uk (024_add_thekitman_site.sql) - a real crawl run's
-- browser-rendered fetch of its own homepage came back as a full
-- "Robot Challenge Screen" interstitial (HTTP 202, no real content or
-- links) - see services/blockDetector.ts's own comment on that phrase.
-- Same category of protection as Classic Football Shirts above, same
-- decision not to pursue a bypass.
UPDATE sites SET is_active = false, blocked_reason =
  'Browser-rendered homepage returned a "Robot Challenge Screen" interstitial (HTTP 202, no real content or links) - confirmed via a real crawl run. Same anti-bot category as Classic Football Shirts; not pursuing a bypass for the same reason.'
WHERE base_url = 'https://www.thekitman.co.uk';
