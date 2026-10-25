-- Adds footballshirtkingdom.com (a football shirt retailer) at the user's
-- explicit request, using the proven Shopify settings directly rather than
-- the usual cautious-first-then-loosen onboarding (019_add_casual_football_
-- shirts_site.sql / 026_add_footballfinery_site.sql + 027_footballfinery_
-- proven_settings.sql) - this session's own sandbox network policy denies
-- outbound connections to this domain, same restriction hit on every other
-- site onboarded this way, but a web search confirmed the platform and
-- real URLs matching Shopify's standard routing exactly, not a per-site
-- convention:
--   https://footballshirtkingdom.com/products/borussia-dortmund-2021-football-shirt-3xl-7806
--   https://footballshirtkingdom.com/collections/all-football-shirts
--   https://footballshirtkingdom.com/collections/in-stock
--
-- Unlike every other site added this way, this one skips straight to the
-- settings Casual Football Shirts/Football Finery only reached AFTER a
-- real crawl (or a live view-source check) proved JSON-LD comes back over
-- plain HTTP with no bot challenge - that proof doesn't exist yet for this
-- site specifically, the user asked for the proven Shopify settings
-- directly rather than the cautious unaudited defaults. If a crawl surfaces
-- errors, a block page, or empty/wrong profile data, that's the signal to
-- fall back to the cautious defaults (use_browser_default = true,
-- rate_limit_rps = 1) the same way every other Shopify site started out.
--
--   * allowed_paths = ARRAY['/products/*'] - confirmed via the real
--     product URLs above.
--   * denied_paths - same generic Shopify denylist already proven on
--     every other Shopify site onboarded this way.
--   * use_browser_default = false, skip_browser_for_items = false (to
--     match, since the browser is never turned on for this site at all) -
--     the proven Casual Football Shirts/Football Finery configuration.
--   * rate_limit_rps = 2, max_depth = 3 - same proven values.
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
  'Football Shirt Kingdom',
  'https://footballshirtkingdom.com',
  2,
  3,
  false,
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
