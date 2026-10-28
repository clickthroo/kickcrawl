-- Every sampled failure for this site today was a browser-launch/context
-- error (Target page, context or browser has been closed; Protocol error:
-- Failed to create browser context; net::ERR_ABORTED - frame detached) -
-- the same Chromium resource-contention class already fixed for The Soccer
-- Archive, not a site-specific block or legitimate HTTP error. With
-- use_browser_default still true, every one of this site's ~48,000 frontier
-- pages was contending for the single shared browser slot. Two other sites
-- on the same /products/* Shopify pattern (Soccer Archive, Football Shirt
-- Kingdom) already run cleanly with browser rendering off.
UPDATE sites SET use_browser_default = false WHERE base_url = 'https://vintagefootballshirts.com';
