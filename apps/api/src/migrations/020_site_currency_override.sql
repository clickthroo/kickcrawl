-- Some sites pick a visitor's price currency by the request's own
-- perceived geolocation (Shopify Markets and similar), with nothing
-- pinning it to a fixed currency otherwise. Discovered running a live
-- test crawl of casualfootballshirts.co.uk right after adding it: this
-- app's own outbound fetches were consistently served US-market pricing
-- (e.g. a real £129.99 item came back as "194 USD", not even a correct
-- FX-converted figure - USD:GBP conversion was never configured, so it
-- would otherwise have sat in the database mislabeled and ~50% inflated,
-- forever, for every single item on this site) - confirmed reproducible
-- and confirmed fixable: Shopify's own `?currency=<code>` query param
-- override reliably pins the market regardless of requester geolocation.
--
-- Left NULL (no override) for every existing site - none of them showed
-- this symptom, and null is the safe default (identical fetch behaviour
-- to before this column existed) for any future site that doesn't need it.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS currency_override text;

UPDATE sites SET currency_override = 'GBP' WHERE base_url = 'https://casualfootballshirts.co.uk';
