-- Adds thesoccerarchive.com (a vintage/retro football shirt retailer) at
-- the user's request. Not live-audited the normal way (see
-- 019_add_casual_football_shirts_site.sql's own comment for that
-- process) - this session's own sandbox network policy denies outbound
-- connections to this domain, same restriction hit on thekitman.co.uk
-- (024) and footballfinery.co.uk (026). Better-informed than a fully
-- blind add though, same as footballfinery.co.uk's own case: a web
-- search turned up a Pixel Kicks case study confirming the platform
-- (Shopify Plus) and several real, working URLs straight off the site -
--   https://thesoccerarchive.com/products/arsenal-2010-11-home-shirt-fabregas-4-xl
--   https://thesoccerarchive.com/collections/all
--   https://thesoccerarchive.com/collections/heroes
--   https://thesoccerarchive.com/collections/national-teams
-- all matching Shopify's own standard /products/<handle> and
-- /collections/<handle> routing exactly, not a per-site convention - solid
-- evidence even without a live audit of the rest of the site.
--
--   * allowed_paths = ARRAY['/products/*'] - confirmed via the real
--     product URL above, same as footballfinery.co.uk's onboarding.
--   * denied_paths - same generic Shopify denylist already proven on
--     Casual Football Shirts (019), thekitman.co.uk (024), and Football
--     Finery (026).
--   * use_browser_default = true, rate_limit_rps = 1, max_depth = 2 -
--     deliberately conservative: knowing the platform is Shopify doesn't
--     confirm this store's theme serves JSON-LD without JS, or whether
--     it's behind Cloudflare/a bot challenge (Classic Football Shirts is
--     Shopify-adjacent tooling too, and that one IS Cloudflare-gated -
--     see 025_mark_known_blocked_sites.sql). Once a Map/crawl run
--     confirms real JSON-LD comes back over plain HTTP with no challenge
--     page, these can be loosened to match the other proven Shopify
--     stores' defaults (browser off, rate_limit_rps 2, max_depth 3) - see
--     027_footballfinery_proven_settings.sql for exactly that follow-up.
--   * default_selectors = '{}' - relies on the same generic schema.org
--     JSON-LD extraction already proven on the other Shopify stores.
--   * require_pro_seller = false, min_seller_feedback = null - a direct
--     retailer, not a marketplace.
--
-- ON CONFLICT (base_url) DO NOTHING - base_url is UNIQUE (001_init.sql).
INSERT INTO sites (
  name, base_url, rate_limit_rps, max_depth, use_browser_default, skip_browser_for_items,
  use_proxy, default_selectors, allowed_paths, denied_paths, is_active,
  require_pro_seller, min_seller_feedback
) VALUES (
  'The Soccer Archive',
  'https://thesoccerarchive.com',
  1,
  2,
  true,
  false,
  false,
  '{}',
  ARRAY['/products/*'],
  ARRAY['/cart', '/account*', '/checkout*', '/checkouts*', '/orders*', '/admin*', '/search*', '/policies/*', '/a/downloads/-/*'],
  true,
  false,
  NULL
)
ON CONFLICT (base_url) DO NOTHING;
