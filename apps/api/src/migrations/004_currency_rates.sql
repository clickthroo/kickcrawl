-- Admin-maintained approximate FX rates used to convert a non-GBP listing
-- price into Kickio's own GBP-denominated price (see kickioProfile.ts).
-- Keyed by ISO 4217 currency code, not country, since a currency can span
-- multiple countries (e.g. EUR) and the source is always the site's own
-- reported currency code, not a country. No rows are seeded - an admin adds
-- a rate for each currency their sites report, from the Settings page.
CREATE TABLE IF NOT EXISTS currency_rates (
  code text PRIMARY KEY,
  rate_to_gbp numeric NOT NULL CHECK (rate_to_gbp > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
