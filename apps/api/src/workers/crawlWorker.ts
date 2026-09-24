import { Worker, type Job } from 'bullmq';
import { redisConnection, type CrawlJobData } from '../queue.js';
import { pool } from '../db.js';
import { scrapePage, type ScrapeCoreResult, type ScrapeFormat } from '../lib/scrapeCore.js';
import { resolveSiteForUrl } from '../lib/siteResolver.js';
import { markUrlFetched, markUrlQueued, upsertDiscoveredUrls } from '../lib/urlStore.js';
import { persistScrapeResult } from '../lib/persistResult.js';
import { isPathAllowed, isSameSite, matchesPathPattern } from '../services/links.js';
import { detectSellerSignals } from '../services/sellerSignals.js';
import { BROWSER_FATAL_PATTERN } from '../services/fetcher.js';
import { buildKickioProfile, type KickioTeamRef } from '../services/kickioProfile.js';
import { persistItemProfileColumns } from '../lib/persistItemProfile.js';
import { detectAndRecordTransition, getPreviousStockAndPrice } from '../lib/saleDetection.js';
import { getCurrencyRates } from '../lib/currencyRates.js';
import { getKickioTeamsForMatching } from '../lib/kickioTeams.js';
import { resumeCrawlJob } from '../lib/jobRecords.js';
import { config } from '../config.js';
import type { SiteConfig } from '../lib/siteResolver.js';

/**
 * Which of a page's outbound same-site links the crawl should follow next.
 * denied_paths is a hard stop - dropped here so a denied page is never even
 * visited, not just never recorded. allowed_paths is deliberately NOT
 * applied here: a page outside it (e.g. a category/collection listing) is
 * often the only way to *reach* pages that are inside it (e.g. individual
 * product pages), so it still needs to be visited and have its own links
 * followed - see isCrawlItem() for the allow-list check that decides
 * whether a visited page gets recorded as an Item.
 */
export function filterTraversableLinks(
  links: string[],
  visited: Set<string>,
  excludePaths: string[],
): string[] {
  return links.filter((l) => !visited.has(l)).filter((l) => isPathAllowed(new URL(l).pathname, [], excludePaths));
}

/**
 * The catalog category id a Vinted-shaped catalog URL is scoped to, read
 * from either form it's carried in - the query param on a search/filter
 * URL (?catalog[]=3267) or the leading path segment on a category page
 * (/catalog/3267-team-shirts-and-jerseys). Returns null for a URL that
 * isn't itself a catalog listing at all (an item page, a help page, a
 * member profile) - those aren't scoped by category the same way, so
 * they're not something this can meaningfully compare.
 */
export function catalogIdFromUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const queryId = u.searchParams.get('catalog[]');
  if (queryId) return queryId;
  const pathMatch = u.pathname.match(/\/catalog\/(\d+)-/);
  return pathMatch ? pathMatch[1] : null;
}

/**
 * Whether a visited page counts as a real Item - gets its content
 * persisted and shown in the Items list - rather than just a stepping
 * stone the crawl passed through to discover further links. An empty
 * allowed_paths means everything visited (that isn't denied) is an item.
 */
export function isCrawlItem(path: string, includePaths: string[]): boolean {
  if (includePaths.length === 0) return true;
  return includePaths.some((p) => matchesPathPattern(path, p));
}

/**
 * Whether this specific page fetch should render via a real browser.
 * Browser rendering only ever matters for a page's own LINKS - an item
 * page's links are never followed at all (see the "not matchesAllowedPaths"
 * guard around the traversal code below) - so a site that's confirmed its
 * item pages' own content (title, price, stock) renders fine over plain
 * HTTP even when its nav doesn't (skip_browser_for_items) can skip
 * Playwright, and the single global browser slot every browser-driven
 * fetch across the whole app serializes through (services/browser.ts),
 * for exactly the pages that don't need it. A non-item (nav/category)
 * page always keeps the job's own setting, since THAT'S the page whose
 * links actually get traversed.
 */
export function resolveUseBrowser(
  matchesAllowedPaths: boolean,
  jobUseBrowser: boolean | undefined,
  site: Pick<SiteConfig, 'skip_browser_for_items'> | null | undefined,
): boolean | undefined {
  if (matchesAllowedPaths && site?.skip_browser_for_items) return false;
  return jobUseBrowser;
}

async function updateJobProgress(jobId: string, total: number, completed: number): Promise<void> {
  // Guarded so this can never clobber a 'paused'/'cancelled' status an
  // admin set while this iteration's own page fetch was already in
  // flight - without the guard, this unconditional write would flip the
  // row straight back to 'running' right after, and the next loop
  // iteration's own status check (which runs before this is called again)
  // would then see 'running' and keep going, defeating the pause/cancel
  // the admin just clicked.
  await pool.query(
    `UPDATE jobs SET status = 'running', total_pages = $2, completed_pages = $3
     WHERE id = $1 AND status NOT IN ('paused', 'cancelled')`,
    [jobId, total, completed],
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getJobStatus(jobId: string): Promise<string | undefined> {
  const { rows } = await pool.query<{ status: string }>('SELECT status FROM jobs WHERE id = $1', [jobId]);
  return rows[0]?.status;
}

// How often a paused crawl re-checks whether an admin has resumed or
// cancelled it. BullMQ renews this job's own lock automatically as long as
// the worker function hasn't returned, so sitting in this loop for a long
// time (an admin could leave a crawl paused for hours) doesn't risk BullMQ
// treating it as stalled the way an unattended fetch would.
const PAUSE_POLL_INTERVAL_MS = 3_000;

// Confirmed in production on VFS: 75% of already-discovered product urls
// (5384 of 7200) ended up permanently lost after exactly one failed fetch
// - overwhelmingly the shared browser instance crashing/closing mid-fetch,
// the same transient failure scrapePageWithTimeout already knows how to
// recover from for the NEXT page, just not for this one's own single
// attempt. A page that fails now gets up to this many total tries before
// crawl_frontier gives up on it for real.
const MAX_FRONTIER_ATTEMPTS = 3;
// Each retry waits longer than the last (attempts * this many minutes) -
// deferred to later in the queue rather than retried back-to-back, so a
// crashed browser (which recycles on its own within a couple of minutes,
// per this same session's own earlier findings) has real time to recover
// instead of the retry landing in the middle of the same crash.
const FRONTIER_RETRY_BACKOFF_MINUTES = 2;
// How long to wait before re-checking for available work when every
// remaining pending row is deferred for a retry - short relative to the
// backoff itself; the main loop re-checks cancel/pause status on every
// pass regardless, so this never blocks a pause/cancel from taking effect
// for long.
const FRONTIER_RETRY_POLL_MS = 5_000;

/**
 * Blocks while a job's status is 'paused', re-checking on an interval.
 * Returns the status that ended the wait - either 'cancelled' (the caller
 * should stop the crawl entirely) or whatever non-'paused' status it saw
 * (normally 'running', once an admin hits Resume).
 */
async function waitWhilePaused(jobId: string): Promise<string | undefined> {
  let status = await getJobStatus(jobId);
  while (status === 'paused') {
    await sleep(PAUSE_POLL_INTERVAL_MS);
    status = await getJobStatus(jobId);
  }
  return status;
}

/**
 * Whether a fetched item passes the site's seller-trust filters (Vinted's
 * Pro badge + feedback count, services/sellerSignals.ts) - checked once
 * the page's own content is available, since these signals are read from
 * the page's rendered text, not looked up separately. A site with
 * neither filter configured always passes (most sites have no concept of
 * a "seller" at all). When a filter IS configured but its signal can't
 * be found on the page, the item fails closed - a page we can't confirm
 * passes shouldn't be kept just because we couldn't check it.
 */
export function passesSellerFilter(
  markdown: string | undefined,
  site: Pick<SiteConfig, 'require_pro_seller' | 'min_seller_feedback'>,
): boolean {
  if (!site.require_pro_seller && site.min_seller_feedback == null) return true;
  if (!markdown) return false;

  const { feedbackCount, isPro } = detectSellerSignals(markdown);
  if (site.require_pro_seller && !isPro) return false;
  if (site.min_seller_feedback != null && (feedbackCount == null || feedbackCount < site.min_seller_feedback)) {
    return false;
  }
  return true;
}

async function recordPageResult(
  siteId: string,
  jobId: string,
  url: string,
  result: ScrapeCoreResult,
): Promise<string> {
  const urlId = await markUrlFetched(siteId, url, result.metadata.statusCode, result.error);
  await persistScrapeResult(urlId, jobId, result);
  return urlId;
}

// Builds and persists the same profile columns a recheck already does
// (lib/persistItemProfile.ts), at the point an item is first discovered
// rather than only hours later on its first recheck - so the admin Items
// list's SQL-side filters (team, stock status, ...) have real data for a
// brand new item immediately, not "no value yet" until the next recheck
// cycle.
export async function recordItemProfile(
  urlId: string,
  siteId: string,
  url: string,
  result: ScrapeCoreResult,
  currencyRates: Record<string, number>,
  kickioTeams: readonly KickioTeamRef[] | null,
): Promise<{ sale: boolean; priceChange: boolean }> {
  const profile = buildKickioProfile({
    url,
    title: result.metadata.title,
    description: result.markdown?.slice(0, 4000) ?? null,
    images: result.metadata.image ? [result.metadata.image] : [],
    extracted: result.extracted,
    currencyRates,
    kickioTeams,
  });
  // Read BEFORE persistItemProfileColumns overwrites it - a crawl job
  // re-fetches already-known urls constantly (confirmed in production:
  // 2114 distinct urls touched by more than one separate crawl job), and
  // until now that overwrite happened with no comparison at all, so any
  // In Stock -> Out of Stock transition a crawl (rather than the hourly
  // recheck) happened to be the one to observe was silently lost - the
  // write went through, but nothing ever checked whether it was a sale.
  const previous = await getPreviousStockAndPrice(urlId);
  const outcome = await detectAndRecordTransition(urlId, siteId, result.metadata.title, previous, profile);
  await persistItemProfileColumns(urlId, profile);
  return outcome;
}

// A catch-all safety net around the per-page fetch. Every individual I/O
// call inside scrapePage() (DNS, robots.txt, the HTTP fetch, the browser
// navigation) already has its own timeout, but that only helps if every
// future code path in there remembers to add one too - a single page
// hanging on some untimed corner (e.g. browser.newContext(),
// context.close()) would otherwise freeze the whole job forever, since
// the crawl loop is strictly sequential. 90s is generous enough to cover
// the slowest legitimate case (a near-max robots Crawl-delay plus a
// blocked-page browser retry) without masking a real hang for long.
export const PAGE_TIMEOUT_MS = 90_000;

async function scrapePageOnce(
  url: string,
  opts: Parameters<typeof scrapePage>[1],
  site: Parameters<typeof scrapePage>[2],
): Promise<ScrapeCoreResult> {
  // Recycling the shared Chromium instance (services/browser.ts) on a
  // fatal browser error used to happen here too, AFTER scrapePage() had
  // already returned. By that point services/browser.ts's own
  // withBrowserSlot had already released its single app-wide slot, so a
  // different concurrently running job (concurrency: 3) could already be
  // mid-fetch on a brand new browser instance - and this outer,
  // context-unaware closeBrowser() call would tear that healthy browser
  // out from under it, producing the exact same "browser has been closed"
  // error that made IT recycle too, cascading into a self-sustaining
  // failure storm from one initial crash. That recycling now happens
  // inside services/fetcher.ts's fetchWithBrowser() instead, still within
  // withBrowserSlot, where at most one browser-driven fetch is ever in
  // flight app-wide - so there's no other job's browser left for it to
  // race against.
  return await Promise.race([
    scrapePage(url, opts, site),
    new Promise<ScrapeCoreResult>((resolve) =>
      setTimeout(() => {
        resolve({
          success: false,
          error: `Timed out after ${PAGE_TIMEOUT_MS}ms fetching this page`,
          metadata: { sourceURL: url, statusCode: 0, images: [] },
        });
      }, PAGE_TIMEOUT_MS),
    ),
  ]);
}

export async function scrapePageWithTimeout(
  url: string,
  opts: Parameters<typeof scrapePage>[1],
  site: Parameters<typeof scrapePage>[2],
): Promise<ScrapeCoreResult> {
  const result = await scrapePageOnce(url, opts, site);
  // A fatal browser crash (BROWSER_FATAL_PATTERN, fetcher.ts) has already
  // backed off and gotten a fresh Chromium instance by the time this
  // promise settles - so one retry here has a real chance of succeeding,
  // rather than leaving this page permanently failed. Confirmed in
  // production as a real, separate cost of the crash itself: a crawl
  // job's SEED page (depth 0, the only URL queued at that point) hit
  // exactly one of these crashes and the whole job ended there - zero
  // pages ever fetched, no links ever discovered to try instead, nothing
  // left in queue to fall back to. Scoped to this one pattern rather than
  // every failure - an ordinary 404, a real site outage, or a
  // robots.txt/seller-filter rejection all deserve to fail once and stay
  // failed, not be retried against odds that haven't actually improved.
  if (!result.success && result.error && BROWSER_FATAL_PATTERN.test(result.error)) {
    return await scrapePageOnce(url, opts, site);
  }
  return result;
}

async function fireWebhook(jobId: string, status: string): Promise<void> {
  if (!config.webhookUrl) return;
  try {
    await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, status, event: 'crawl.completed' }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // webhook delivery is best-effort
  }
}

async function processCrawl(job: Job<CrawlJobData>): Promise<void> {
  const { jobId, siteId, url, limit, maxDepth, includePaths, excludePaths, scrapeOptions } =
    job.data;
  const origin = new URL(url).origin;
  // A crawl seeded from a category-scoped catalog URL (e.g.
  // catalog[]=3267 for "Team shirts & jerseys") should stay within that
  // category - null when the seed itself isn't catalog-shaped (a direct
  // item seed, or a non-Vinted site), in which case no such scoping
  // applies at all and every traversable link is treated as before.
  const seedCatalogId = catalogIdFromUrl(url);

  // Fetched once per job, not per page - both are small, admin-maintained
  // lookups (currency_rates table, Kickio's own teams list), the same
  // pattern recheckWorker.ts already uses.
  const currencyRates = await getCurrencyRates();
  const kickioTeams = await getKickioTeamsForMatching();

  // Resume support: crawl_frontier (migration 012) persists every
  // discovered URL for this job - the in-memory queue/visited state a
  // restart used to lose completely, which is why recoverOrphanedJobs()
  // (jobRecords.ts) used to have no choice but to permanently fail any
  // job still 'running' at boot. On a fresh job the table has no rows for
  // this job_id yet, so the seed URL is inserted as the only 'pending'
  // entry, same as the old in-memory queue's initial state. On a resume
  // (a previous run of this same job_id left rows behind), `visited` is
  // seeded from every row already recorded regardless of status - both
  // 'done' (already processed) and 'pending' (already queued, just not
  // reached yet) - so filterTraversableLinks doesn't waste work
  // re-discovering them, though the table's own UNIQUE(job_id, url)
  // constraint would make re-inserting them a harmless no-op either way.
  const visited = new Set<string>();
  const seedUrl = new URL(url).toString();
  const existingFrontier = await pool.query<{ url: string; status: string }>(
    `SELECT url, status FROM crawl_frontier WHERE job_id = $1`,
    [jobId],
  );
  let pendingCount: number;
  let doneCount: number;
  let completed: number;
  // Seeded from the jobs row's own errors/error_count on resume, not just
  // reset to empty - those columns are still the only record of errors
  // from a segment that ended before this restart (per-page errors were
  // never themselves persisted to crawl_frontier), and the final UPDATE
  // below replaces both columns outright rather than appending.
  const errors: string[] = [];
  if (existingFrontier.rows.length === 0) {
    await pool.query(
      `INSERT INTO crawl_frontier (job_id, url, depth, status) VALUES ($1, $2, 0, 'pending') ON CONFLICT (job_id, url) DO NOTHING`,
      [jobId, seedUrl],
    );
    pendingCount = 1;
    doneCount = 0;
    completed = 0;
  } else {
    pendingCount = 0;
    doneCount = 0;
    for (const row of existingFrontier.rows) {
      visited.add(row.url);
      if (row.status === 'done') doneCount += 1;
      else pendingCount += 1;
    }
    const jobRow = await pool.query<{ completed_pages: number; errors: { message: string }[] | null }>(
      `SELECT completed_pages, errors FROM jobs WHERE id = $1`,
      [jobId],
    );
    completed = jobRow.rows[0]?.completed_pages ?? 0;
    for (const e of jobRow.rows[0]?.errors ?? []) {
      if (e?.message) errors.push(e.message);
    }
    console.log(
      `[crawlWorker] job ${jobId} resuming from crawl_frontier: ${doneCount} done, ${pendingCount} pending, ${completed} completed item(s)`,
    );
  }
  let cancelled = false;

  // Cancelling a job that's still 'queued' (BullMQ hasn't picked it up
  // yet) or already 'paused' when this worker function starts is handled
  // the same way as a mid-run cancel below - just before any work happens
  // instead of after some of it already has.
  if ((await getJobStatus(jobId)) === 'cancelled') return;

  await updateJobProgress(jobId, Math.min(limit, doneCount + pendingCount), completed);

  while (pendingCount > 0 && doneCount < limit) {
    const status = await getJobStatus(jobId);
    if (status === 'cancelled') {
      cancelled = true;
      break;
    }
    if (status === 'paused') {
      const afterPause = await waitWhilePaused(jobId);
      if (afterPause === 'cancelled') {
        cancelled = true;
        break;
      }
    }

    const nextRow = await pool.query<{ id: string; url: string; depth: number; attempts: number }>(
      `SELECT id, url, depth, attempts FROM crawl_frontier
       WHERE job_id = $1 AND status = 'pending' AND available_at <= now()
       ORDER BY available_at ASC, id ASC LIMIT 1`,
      [jobId],
    );
    if (nextRow.rows.length === 0) {
      if (pendingCount > 0) {
        // Nothing immediately available, but real pending work still
        // exists - it's just deferred for a retry backoff, not actually
        // exhausted. Wait a bit and check again rather than concluding
        // the job is done.
        await sleep(FRONTIER_RETRY_POLL_MS);
        continue;
      }
      break;
    }
    const frontierId = nextRow.rows[0].id;
    const attemptsSoFar = nextRow.rows[0].attempts;
    const next = { url: nextRow.rows[0].url, depth: nextRow.rows[0].depth };

    // The seed (depth 0) is always an item, same as before. Anything else
    // is an item only if it matches allowed_paths - a page that doesn't
    // (e.g. a category/collection listing) still gets fetched below and
    // has its links followed, it just isn't recorded as an Item itself.
    const path = new URL(next.url).pathname;
    const matchesAllowedPaths = isCrawlItem(path, includePaths);
    const isItem = next.depth === 0 || matchesAllowedPaths;

    // Re-read fresh every iteration rather than once before the loop -
    // confirmed in production: a site's seller filters (require_pro_seller,
    // min_seller_feedback) are meant to be editable from the admin UI at
    // any time, but a crawl can run for a very long time (up to `limit`
    // pages), and holding one site config object for that whole duration
    // meant an item fetched hours into a job was still being filtered
    // against whatever the settings were when the job STARTED, not what
    // they actually are now. The sites table is small and admin-managed,
    // so a query per page is negligible next to the page fetch itself.
    const site = await resolveSiteForUrl(next.url);

    if (isItem) await markUrlQueued(siteId, next.url);

    console.log(
      `[crawlWorker] job ${jobId} fetching ${next.url} (depth ${next.depth}, ${completed}/${limit} done, ${pendingCount} queued)`,
    );
    // A non-item page's markdown/extracted content is never read anywhere
    // below - it only exists here to have its links followed - so it has
    // no reason to request 'markdown' at all. That's not a micro-
    // optimization: confirmed via Railway's own heap logging, Node's heap
    // actually *drops* between ordinary pages (GC is doing its job fine),
    // and the real cost is scrapePage()'s markdown/extraction pipeline
    // running in full on Vinted's own catalog/search listing pages -
    // heavy, JS-hydrated pages that are never items themselves (they
    // don't match allowed_paths) yet were getting fully processed anyway
    // on every fetch. 'links' is always requested (in addition to
    // whatever formats an item page needs) so scrapePage() computes them
    // itself from the single CheerioAPI it already parses internally
    // (services/scrapeCore.ts), instead of this file re-parsing the same
    // raw HTML a second time.
    const baseFormats: ScrapeFormat[] = isItem ? scrapeOptions.formats ?? ['markdown'] : [];
    const formats: ScrapeFormat[] = baseFormats.includes('links') ? baseFormats : [...baseFormats, 'links'];
    const useBrowser = resolveUseBrowser(matchesAllowedPaths, scrapeOptions.useBrowser, site);
    const result = await scrapePageWithTimeout(
      next.url,
      { formats, onlyMainContent: scrapeOptions.onlyMainContent ?? true, useBrowser },
      site,
    );
    if (!result.success) {
      const attemptsMade = attemptsSoFar + 1;
      if (attemptsMade < MAX_FRONTIER_ATTEMPTS) {
        // Not given up on yet - stays 'pending' (pendingCount/doneCount
        // untouched, no error recorded yet) so it's picked up again once
        // its backoff passes, instead of being thrown away after this one
        // attempt.
        console.log(
          `[crawlWorker] job ${jobId} will retry ${next.url} (attempt ${attemptsMade}/${MAX_FRONTIER_ATTEMPTS} failed: ${result.error})`,
        );
        await pool.query(`UPDATE crawl_frontier SET attempts = $2, available_at = $3 WHERE id = $1`, [
          frontierId,
          attemptsMade,
          new Date(Date.now() + attemptsMade * FRONTIER_RETRY_BACKOFF_MINUTES * 60_000),
        ]);
        continue;
      }

      console.log(`[crawlWorker] job ${jobId} failed ${next.url} after ${attemptsMade} attempt(s): ${result.error}`);
      await pool.query(`UPDATE crawl_frontier SET status = 'done' WHERE id = $1`, [frontierId]);
      pendingCount -= 1;
      doneCount += 1;
      // Recorded regardless of isItem - previously a failed fetch on a
      // non-item (nav/category) page was completely silent: no error, no
      // retry, nothing in the job's error count, just a page that
      // contributed zero links to the queue as if it had never existed.
      // That made a crawl that was quietly failing on most of its
      // category pages look identical to "0 errors" in the UI, with no
      // way to tell a genuinely small site apart from one where discovery
      // was silently dying page after page.
      errors.push(`${next.url}${isItem ? '' : ' (nav/category page - not counted as an item)'}: ${result.error}`);
      if (isItem) {
        await recordPageResult(siteId, jobId, next.url, result);
      }
    } else {
      await pool.query(`UPDATE crawl_frontier SET status = 'done' WHERE id = $1`, [frontierId]);
      pendingCount -= 1;
      doneCount += 1;
      if (isItem) {
        // The seller filter only makes sense for a page that's genuinely
        // an item by its own path - a catalog/search seed forced into
        // isItem purely by being depth 0 has no single seller to check
        // at all (it's a listing of many items, each with their own),
        // so scanning its whole page would just catch whichever
        // unrelated item happens to appear first, not a real signal.
        const passesFilter =
          !matchesAllowedPaths ||
          passesSellerFilter(result.markdown, site ?? { require_pro_seller: false, min_seller_feedback: null });
        if (passesFilter) {
          const urlId = await recordPageResult(siteId, jobId, next.url, result);
          const { sale, priceChange } = await recordItemProfile(urlId, siteId, next.url, result, currencyRates, kickioTeams);
          if (sale) console.log(`[crawlWorker] job ${jobId} detected a sale on re-fetch: ${next.url}`);
          if (priceChange) console.log(`[crawlWorker] job ${jobId} detected a price change on re-fetch: ${next.url}`);
          completed += 1;
        } else {
          // Fetched, but doesn't meet the site's seller filter - keep
          // the url row's own status accurate (it really was fetched)
          // without persisting content for an item we're deliberately
          // not keeping.
          await markUrlFetched(siteId, next.url, result.metadata.statusCode, result.error);
        }
      }

      // Only a catalog/listing page's own links are worth following further
      // (matchesAllowedPaths false - it's not itself an item by URL shape).
      // An item's own detail page has no legitimate reason to expose
      // further crawl-worthy links: everything on it is either a
      // breadcrumb back to a catalog page we'd reach anyway, or an
      // unrelated recommendation widget ("Similar items", the seller's
      // other listings). Confirmed in production: crawling a football-
      // shirts-only catalog still turned up a completely unrelated item
      // (a jumper) because that widget's link on some other item's own
      // page matched allowed_paths (/items/*) just as well as a genuine
      // shirt link would - allowed_paths checks URL shape, not category,
      // and Vinted item URLs don't encode category at all. Not following
      // links from an item page at all stops that item from ever being
      // fetched in the first place, rather than fetching it and then
      // trying to filter it back out after the fact.
      if (!matchesAllowedPaths && next.depth < maxDepth && result.links) {
        const links = result.links.filter((l) => isSameSite(l, origin, false));
        // A catalog-shaped link (its own /catalog/... URL) belonging to a
        // DIFFERENT category than the seed is never followed - confirmed in
        // production: crawling a "Team shirts & jerseys" catalog (seed
        // catalog[]=3267) still wandered into entirely unrelated pages
        // (/catalog/5-men, /catalog/2050-clothing, /catalog/30-activewear -
        // the site's own breadcrumb/nav trail back up to broader parent
        // categories) and discovered whatever unrelated items live inside
        // them (jumpers, jeans, jackets, socks). An item link itself never
        // carries a category id at all (see catalogIdFromUrl's doc comment),
        // so this can only be enforced at the catalog-page level - cutting
        // off the whole branch before it's ever visited, rather than trying
        // to filter its item links back out by category after the fact.
        const inScope = (l: string) => {
          const linkCatalogId = catalogIdFromUrl(l);
          return !seedCatalogId || linkCatalogId === null || linkCatalogId === seedCatalogId;
        };
        const newLinks = filterTraversableLinks(links, visited, excludePaths).filter(inScope);
        // Only the links that will themselves be items get recorded into
        // the Items list - stepping-stone links (e.g. more category
        // pages) still get queued and traversed below, just not shown.
        const itemLinks = newLinks.filter((l) => isCrawlItem(new URL(l).pathname, includePaths));
        await upsertDiscoveredUrls(siteId, itemLinks);
        if (newLinks.length > 0) {
          for (const link of newLinks) visited.add(link);
          const values: string[] = [];
          const params: unknown[] = [jobId];
          for (const link of newLinks) {
            params.push(link, next.depth + 1);
            values.push(`($1, $${params.length - 1}, $${params.length}, 'pending')`);
          }
          // ON CONFLICT DO NOTHING is what makes re-discovering the same
          // URL from a different page a safe no-op - the same guarantee
          // the old in-memory visited Set gave the queue.push() this
          // replaces, now also holding across a resumed job whose
          // in-memory `visited` above was only just repopulated from the
          // table, not accumulated fresh over this run's own traversal.
          const inserted = await pool.query(
            `INSERT INTO crawl_frontier (job_id, url, depth, status) VALUES ${values.join(', ')} ON CONFLICT (job_id, url) DO NOTHING`,
            params,
          );
          pendingCount += inserted.rowCount ?? 0;
        }
      }
    }

    await updateJobProgress(jobId, Math.min(limit, doneCount + pendingCount), completed);

    // Diagnostic for the still-unexplained Vinted OOM: the crash tracks
    // with cumulative pages processed in this same job (page sizes alone
    // are ordinary, and de-duplicating the HTML parse per page - the
    // previous fix - didn't move where it happens), so something is
    // accumulating across iterations of this loop that isn't being
    // released. Logging Node's own heap after every page shows the real
    // growth curve instead of guessing at another cause blind.
    const mem = process.memoryUsage();
    console.log(
      `[crawlWorker] job ${jobId} heap after ${next.url}: heapUsed=${(mem.heapUsed / 1_048_576).toFixed(1)}MB rss=${(mem.rss / 1_048_576).toFixed(1)}MB external=${(mem.external / 1_048_576).toFixed(1)}MB`,
    );
  }

  const finalStatus = cancelled ? 'cancelled' : 'completed';
  await pool.query(
    `UPDATE jobs SET status = $6, total_pages = $2, completed_pages = $3,
       error_count = $4, errors = $5::jsonb, finished_at = now() WHERE id = $1`,
    [jobId, doneCount, completed, errors.length, JSON.stringify(errors.map((e) => ({ message: e }))), finalStatus],
  );

  await fireWebhook(jobId, finalStatus);
}

export function startCrawlWorker(): Worker<CrawlJobData> {
  const worker = new Worker<CrawlJobData>(
    'crawl',
    async (job) => {
      try {
        await processCrawl(job);
      } catch (err) {
        await pool.query(
          `UPDATE jobs SET status = 'failed', error_count = error_count + 1,
             errors = errors || $2::jsonb, finished_at = now() WHERE id = $1`,
          [
            job.data.jobId,
            JSON.stringify([{ message: err instanceof Error ? err.message : String(err) }]),
          ],
        );
        throw err;
      }
    },
    {
      connection: redisConnection,
      concurrency: 3,
      // recoverOrphanedJobs() (lib/jobRecords.ts) marks any job still
      // 'running' at boot as 'failed', on the assumption that a
      // single-instance app never has a live process to resume it. But
      // BullMQ has its own, independent stalled-job recovery: by default
      // (maxStalledCount: 1) it silently retries a job whose worker died
      // without renewing its lock, re-invoking this same processor from
      // scratch and flipping status back to 'running' underneath our
      // sweep - so a job we'd already declared dead keeps coming back,
      // each restart appending another "interrupted" error while it's
      // actually still executing. maxStalledCount: 0 makes BullMQ treat a
      // stalled job as failed immediately instead of retrying it, so
      // there's nothing left to resurrect a job our own sweep already
      // buried.
      maxStalledCount: 0,
      // BullMQ's own default lockDuration (30s) is shorter than
      // PAGE_TIMEOUT_MS (90s) - the deliberately generous ceiling this file
      // already gives a single slow-but-legitimate page fetch. Confirmed in
      // production: a real Vinted catalog fetch got killed by BullMQ's
      // stall watchdog ("job stalled more than allowable limit") after
      // ~70s, well short of PAGE_TIMEOUT_MS ever getting a chance to
      // apply - maxStalledCount: 0 then made that premature kill
      // permanent instead of retried. Set comfortably above
      // PAGE_TIMEOUT_MS so BullMQ's own stall detection can never preempt
      // the timeout this file was already designed around.
      lockDuration: PAGE_TIMEOUT_MS + 30_000,
    },
  );
  worker.on('failed', (job, err) => {
    console.error(`[crawlWorker] job ${job?.id} failed:`, err);
    // A stall (maxStalledCount: 0 fails it immediately, see above) means
    // the process holding this job's lock died without this handler's own
    // try/catch ever running - Postgres still says 'running' since
    // nothing else touched it. Distinct from processCrawl actually
    // throwing, which already updates Postgres to 'failed' itself above
    // before rethrowing, and which this same resume would wrongly bring
    // back to life on a genuine, non-transient error. Confirmed in
    // production as a real, recurring gap: recoverOrphanedJobs() only
    // ever runs once at boot, and Railway's rolling deploys keep the old
    // process alive for a stretch after the new one is already up, so a
    // job can become newly orphaned after that one boot-time check has
    // already run and before the next deploy ever happens. BullMQ's own
    // stall detection isn't tied to a boot at all, so reacting to it here
    // closes that gap continuously instead of leaving it until whatever
    // deploy happens to come next.
    if (job && /stalled/i.test(err.message)) {
      const { jobId, siteId, ...payload } = job.data;
      resumeCrawlJob(jobId, siteId, payload).catch((resumeErr) =>
        console.error(`[crawlWorker] job ${jobId} failed to auto-resume after a stall:`, resumeErr),
      );
    }
  });
  return worker;
}
