-- Adds casualfootballshirts.co.uk (a Shopify store selling classic/retro
-- football shirts), audited live before adding:
--
--   * robots.txt confirms Shopify ("we use Shopify as our ecommerce
--     platform"), standard /products/<handle> item URLs and
--     /collections/<handle> listing pages, sitemap.xml present.
--   * No Cloudflare (or any other) bot-challenge on any path tested,
--     including product and collection pages, over plain HTTP - unlike
--     classicfootballshirts.co.uk (audited the same way, NOT added: every
--     page there is gated behind an interactive Cloudflare Turnstile
--     challenge that plain fetch AND this app's own headless-Chromium
--     config both failed to clear).
--   * Product pages render a standard schema.org JSON-LD Product block
--     server-side (price, priceCurrency, availability, sku, images) -
--     exactly what services/structuredData.ts's extractStructuredProductData
--     already parses generically, so no per-site selectors are needed
--     (default_selectors stays '{}').
--   * A collection page's product links are present in the plain HTML
--     response with no JS required, so browser rendering isn't needed for
--     traversal either - use_browser_default = false (and
--     skip_browser_for_items = false to match, since the browser is never
--     turned on for this site in the first place).
--   * A direct retailer, not a marketplace - no seller-trust filtering
--     applies (require_pro_seller = false, min_seller_feedback = null),
--     matching Cult Kits' config for the same reason.
--
-- rate_limit_rps left at the current sitewide default (2, see
-- 015_raise_default_rate_limit.sql) - nothing observed during the audit
-- suggested this site is more block-sensitive than that. max_depth = 3
-- mirrors the other multi-level catalog sites already configured
-- (home -> collections -> products, with a little headroom for pagination).
--
-- ON CONFLICT (base_url) DO NOTHING - base_url is UNIQUE (001_init.sql) -
-- so this is safe to leave in migration history even if the site is later
-- added/edited by hand through the admin UI before this deploy ships.
INSERT INTO sites (
  name, base_url, rate_limit_rps, max_depth, use_browser_default, skip_browser_for_items,
  use_proxy, default_selectors, allowed_paths, denied_paths, is_active,
  require_pro_seller, min_seller_feedback
) VALUES (
  'Casual Football Shirts',
  'https://casualfootballshirts.co.uk',
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
