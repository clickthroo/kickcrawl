-- Vintage Football Shirts never went through the usual "start cautious,
-- prove it's safe over a real crawl, then loosen" progression every other
-- Shopify-platform site here did (see 026/027 for Football Finery's own
-- version of that same arc) - it was added directly via the admin UI, so
-- its rate_limit_rps is whatever the form's default happened to be, never
-- deliberately chosen against real evidence of how block-sensitive this
-- site actually is. Since 038 turned its browser rendering off, its item
-- pages now go over plain HTTP at that unproven rate, and the very first
-- production run after that fix already logged a real 429 ("Blocked by
-- anti-bot protection") on one of its product pages (crawl_frontier retry
-- log, job 5bedde04-8882-4335-8a3c-efee7143e822, 2026-10-29). Dropping to
-- the same conservative starting point (1 req/s) every other
-- not-yet-proven Shopify site in this table used (024, 026, 031) rather
-- than waiting to see whether that first 429 was a one-off or the start of
-- a pattern - the cost of being wrong in the cautious direction is a
-- slower crawl; the cost of being wrong in the other direction is the
-- site's own anti-bot protection escalating against every future crawl.
-- Loosen it back to 2 the same way 027 did for Football Finery, once a
-- real crawl run shows no further blocks.
--
-- Matches both the broken (no-www) and intended (www) base_url forms,
-- same as 038, since there's still no migration record of which one this
-- site's row actually used when it was added by hand - and, per
-- lib/migrate.ts's own documented convention (added alongside this
-- migration, directly motivated by 036/037's silent no-op), guarded so a
-- base_url that matches neither form fails this migration loudly instead
-- of quietly updating nothing.
DO $$
BEGIN
  UPDATE sites SET rate_limit_rps = 1
  WHERE base_url IN ('https://vintagefootballshirts.com', 'https://www.vintagefootballshirts.com');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'migration 039: base_url not found for Vintage Football Shirts (neither https://vintagefootballshirts.com nor https://www.vintagefootballshirts.com)';
  END IF;
END $$;
