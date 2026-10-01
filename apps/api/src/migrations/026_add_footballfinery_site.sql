-- Adds footballfinery.co.uk (a Shopify football shirt retailer) at the
-- user's request. Not live-audited the normal way (see
-- 019_add_casual_football_shirts_site.sql) - this session's own sandbox
-- network policy denies outbound connections to this domain, same
-- restriction hit on thekitman.co.uk (024) and others earlier this
-- session - but better-informed than that fully-blind case: the user
-- confirmed the platform (Shopify) and gave a real product URL
-- (/products/2009-10-manchester-united-away-football-shirt-m-nike-9-
-- berbatov-ff304338), which matches Shopify's own standard
-- /products/<handle> routing exactly - not a per-site convention, so
-- this is solid evidence even without a live audit of the rest of the
-- site.
--
--   * allowed_paths = ARRAY['/products/*'] - confirmed via the real
--     product URL above, unlike thekitman.co.uk's unrestricted '{}'
--     (where no real URL example existed yet to confirm a pattern
--     against). Narrower and more useful than crawling unrestricted.
--   * denied_paths - same generic Shopify denylist already proven on
--     Casual Football Shirts (019) and thekitman.co.uk (024).
--   * use_browser_default = true, rate_limit_rps = 1, max_depth = 2 -
--     kept at the SAME conservative level as thekitman.co.uk's still
--     applies: knowing the platform is Shopify doesn't confirm THIS
--     store's theme serves JSON-LD without JS, or whether it's behind
--     Cloudflare/a bot challenge (Classic Football Shirts is Shopify-
--     adjacent tooling too, and that one IS Cloudflare-gated - see
--     025_mark_known_blocked_sites.sql). Once a Map/crawl run against
--     this site confirms real JSON-LD comes back over plain HTTP with
--     no challenge page, these can be loosened to match Casual Football
--     Shirts' proven Shopify defaults (browser off, rate_limit_rps 2,
--     max_depth 3).
--   * default_selectors = '{}' - relies on the same generic schema.org
--     JSON-LD extraction already proven on two other Shopify stores.
--   * require_pro_seller = false, min_seller_feedback = null - a direct
--     retailer, not a marketplace.
--
-- ON CONFLICT (base_url) DO NOTHING - base_url is UNIQUE (001_init.sql).
INSERT INTO sites (
  name, base_url, rate_limit_rps, max_depth, use_browser_default, skip_browser_for_items,
  use_proxy, default_selectors, allowed_paths, denied_paths, is_active,
  require_pro_seller, min_seller_feedback
) VALUES (
  'Football Finery',
  'https://www.footballfinery.co.uk',
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
