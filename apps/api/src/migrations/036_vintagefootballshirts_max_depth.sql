-- Vintage Football Shirts' crawl frontier ballooned to 48,234 pages against
-- a real catalog of ~14,666 known product urls (max_depth=5, far deeper than
-- any other site - Soccer Archive uses 2, Football Shirt Kingdom uses 3).
-- Sitemap seeding (filterSitemapSeeds, scoped to this site's own
-- allowed_paths) already finds every real /products/* and
-- /collections/*/products/* page directly, independent of BFS depth, so a
-- 5-level link-following traversal on top of that is mostly just chasing
-- category/filter/pagination permutations that were never going to be items.
UPDATE sites SET max_depth = 3 WHERE base_url = 'https://vintagefootballshirts.com';
