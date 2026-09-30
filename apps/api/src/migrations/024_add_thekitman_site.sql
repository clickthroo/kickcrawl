-- Adds thekitman.co.uk (a football shirt retailer) at the user's request.
-- NOT live-audited before adding, unlike every other site onboarded this
-- way (see 019_add_casual_football_shirts_site.sql's own comment for the
-- normal process) - this session's own sandbox network policy denies
-- outbound connections to this specific domain, the same restriction hit
-- earlier on vintagefootballshirts.com/vinted.co.uk. Configured with
-- deliberately cautious, generic defaults instead, on the understanding
-- that the admin should run a "Map" or "Run crawl" on it and the settings
-- below get refined against real results:
--
--   * use_browser_default = true - unverified whether this site needs JS
--     rendering, so start with the browser on (costs more per fetch, but
--     never risks silently missing content the way defaulting to plain
--     HTTP against a JS-rendered site would).
--   * default_selectors = '{}' - relies entirely on
--     services/structuredData.ts's generic schema.org JSON-LD extraction
--     (price/currency/stock/description/images), the same site-agnostic
--     path that already works without per-site selectors on both Cult
--     Kits and Casual Football Shirts. If this platform doesn't emit
--     standard JSON-LD, prices/stock will come back empty rather than
--     wrong - visible immediately in the Items admin page after a crawl,
--     not a silent failure.
--   * allowed_paths = '{}' (no restriction) - the real product/collection
--     URL pattern is unknown, and an empty array means "crawl anything
--     within max_depth" (see services/links.ts's own
--     matchesPathPattern/includePaths handling) rather than risk guessing
--     a wrong pattern that excludes every real item page outright.
--   * denied_paths - the handful of paths common to nearly every
--     e-commerce platform (cart/account/checkout/admin/search), same
--     generic denylist Casual Football Shirts already uses - safe to
--     include even if this platform doesn't have all of them.
--   * max_depth = 2, rate_limit_rps = 1 - deliberately more conservative
--     than an already-audited site's defaults (3 / 2), specifically
--     because there's been no chance yet to check for anti-bot
--     protection or how block-sensitive this site is.
--   * require_pro_seller = false, min_seller_feedback = null - a direct
--     retailer, not a marketplace, so no seller-trust filtering applies
--     (same reasoning as every other direct-retailer site already
--     configured).
--
-- ON CONFLICT (base_url) DO NOTHING - base_url is UNIQUE (001_init.sql) -
-- safe to leave in migration history even if the site is later
-- edited by hand through the admin UI before this deploy ships.
INSERT INTO sites (
  name, base_url, rate_limit_rps, max_depth, use_browser_default, skip_browser_for_items,
  use_proxy, default_selectors, allowed_paths, denied_paths, is_active,
  require_pro_seller, min_seller_feedback
) VALUES (
  'The Kitman',
  'https://www.thekitman.co.uk',
  1,
  2,
  true,
  false,
  false,
  '{}',
  ARRAY[]::text[],
  ARRAY['/cart', '/account*', '/checkout*', '/checkouts*', '/orders*', '/admin*', '/search*', '/policies/*'],
  true,
  false,
  NULL
)
ON CONFLICT (base_url) DO NOTHING;
