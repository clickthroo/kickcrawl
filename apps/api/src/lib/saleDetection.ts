import { pool } from '../db.js';
import type { KickioProfile } from '../services/kickioProfile.js';

/**
 * A sale is recorded exactly on the In Stock -> Out of Stock transition,
 * not on every check that happens to read "Out of Stock" - a page that's
 * already out of stock (or was never confidently in stock, or is
 * "Unknown") isn't a new sale, it's just still out of stock.
 */
export function isNewSale(previousStatus: string | null, newStatus: string | null): boolean {
  return previousStatus === 'In Stock' && newStatus === 'Out of Stock';
}

// A "meaningful" price change, not every penny of currency-conversion
// rounding noise a check might otherwise see between two reads of a
// price converted through the same admin-maintained GBP rate. Needs both
// a real old and new price in the SAME currency to compare at all - a
// currency change (or either side missing) isn't a price change, it's a
// different kind of event this isn't trying to detect.
//
// The original £0.50-or-1% threshold turned out too tight in production:
// every recorded "price change" so far has been the exact same £0.75
// delta regardless of the item's own price (£72.00→£71.25, £43.50→
// £42.75, ...) - a flat amount independent of price is the signature of
// a shared systematic cause (VFS prices in USD; a small wobble in the
// admin-maintained USD→GBP rate, or similar rounding, moves every item
// by the same converted amount at once), not real independent per-item
// price drops by the retailer. £2 or 2%, whichever is larger, clears
// that observed noise with real margin while still catching a
// deliberate markdown.
const MIN_PRICE_CHANGE_ABSOLUTE = 2;
const MIN_PRICE_CHANGE_RATIO = 0.02;

export function isPriceChange(
  oldPrice: number | null,
  oldCurrency: string | null,
  newPrice: number | null,
  newCurrency: string | null,
): boolean {
  if (oldPrice == null || newPrice == null) return false;
  if (oldCurrency !== newCurrency) return false;
  const threshold = Math.max(MIN_PRICE_CHANGE_ABSOLUTE, oldPrice * MIN_PRICE_CHANGE_RATIO);
  return Math.abs(newPrice - oldPrice) >= threshold;
}

/**
 * The urls columns every sale/price-change comparison needs the OLD value
 * of - read this BEFORE persistItemProfileColumns overwrites them with the
 * freshly scraped profile, whichever worker is doing the overwriting.
 */
export async function getPreviousStockAndPrice(
  urlId: string,
): Promise<{ stock_status: string | null; price: number | null; currency: string | null }> {
  const { rows } = await pool.query<{ stock_status: string | null; price: number | null; currency: string | null }>(
    `SELECT stock_status, price, currency FROM urls WHERE id = $1`,
    [urlId],
  );
  return rows[0] ?? { stock_status: null, price: null, currency: null };
}

/**
 * Compares a freshly built profile against the item's previously recorded
 * stock/price and inserts a sales/price_changes row for whichever real
 * transition(s) it finds - the same check recheckWorker has always run,
 * now shared so crawlWorker's own re-fetch of an already-known item (and
 * the admin's manual re-scrape) can catch a transition too, instead of
 * only ever detecting one when the hourly recheck happens to be the one
 * that observes it.
 */
export async function detectAndRecordTransition(
  urlId: string,
  siteId: string,
  title: string | null | undefined,
  previous: { stock_status: string | null; price: number | null; currency: string | null },
  profile: KickioProfile,
): Promise<{ sale: boolean; priceChange: boolean }> {
  let sale = false;
  let priceChange = false;
  const safeTitle = title ?? null;

  if (isNewSale(previous.stock_status, profile.listing.stock_status)) {
    // A sale's price is the price the item was actually listed/sold at -
    // the PREVIOUS reading, captured while it was still In Stock - not
    // profile.listing.price (the fresh reading from the page AFTER it
    // went Out of Stock). Confirmed in production on the first real sale
    // this system caught: the retailer's page stops rendering a price at
    // all once an item shows as sold out, so profile.listing.price was
    // null at the exact moment of detection even though the item plainly
    // had a real price moments before - the sales row recorded no price
    // even though one was known. Falls back to the fresh reading only if
    // there's no previous price to fall back on at all (a url_id whose
    // very first-ever read already came back Out of Stock, which
    // isNewSale's own In Stock requirement makes unreachable in practice,
    // but keeps this safe against a null previous.price either way).
    const soldPrice = previous.price ?? profile.listing.price;
    const soldCurrency = previous.currency ?? profile.listing.currency;
    await pool.query(
      `INSERT INTO sales (url_id, site_id, title, price, currency, profile) VALUES ($1, $2, $3, $4, $5, $6)`,
      [urlId, siteId, safeTitle, soldPrice, soldCurrency, JSON.stringify(profile)],
    );
    sale = true;
  }

  if (isPriceChange(previous.price, previous.currency, profile.listing.price, profile.listing.currency)) {
    await pool.query(
      `INSERT INTO price_changes (url_id, site_id, title, old_price, new_price, currency, profile)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [urlId, siteId, safeTitle, previous.price, profile.listing.price, profile.listing.currency, JSON.stringify(profile)],
    );
    priceChange = true;
  }

  return { sale, priceChange };
}
