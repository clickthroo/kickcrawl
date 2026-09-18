import { Worker, type Job } from 'bullmq';
import { redisConnection, type CrawlJobData } from '../queue.js';
import { pool } from '../db.js';
import { scrapePage, type ScrapeCoreResult, type ScrapeFormat } from '../lib/scrapeCore.js';
import { resolveSiteForUrl } from '../lib/siteResolver.js';
import { markUrlFetched, markUrlQueued, upsertDiscoveredUrls } from '../lib/urlStore.js';
import { persistScrapeResult } from '../lib/persistResult.js';
import { isPathAllowed, isSameSite, matchesPathPattern } from '../services/links.js';
import { detectSellerSignals } from '../services/sellerSignals.js';
import { closeBrowser } from '../services/browser.js';
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
): Promise<void> {
  const urlId = await markUrlFetched(siteId, url, result.metadata.statusCode, result.error);
  await persistScrapeResult(urlId, jobId, result);
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

export async function scrapePageWithTimeout(
  url: string,
  opts: Parameters<typeof scrapePage>[1],
  site: Parameters<typeof scrapePage>[2],
): Promise<ScrapeCoreResult> {
  let timedOut = false;
  const result = await Promise.race([
    scrapePage(url, opts, site),
    new Promise<ScrapeCoreResult>((resolve) =>
      setTimeout(() => {
        timedOut = true;
        resolve({
          success: false,
          error: `Timed out after ${PAGE_TIMEOUT_MS}ms fetching this page`,
          metadata: { sourceURL: url, statusCode: 0, images: [] },
        });
      }, PAGE_TIMEOUT_MS),
    ),
  ]);

  // Recover the one memoized Chromium instance every browser-driven fetch
  // shares (services/browser.ts) once we have real evidence it's broken,
  // rather than leaving every future request on it to pay for a browser
  // we already know is bad. Confirmed in production: several catalog
  // pages crashed Chromium's renderer in a row ("page.goto: Page
  // crashed") - each one returned quickly, as a normal failure, so
  // nothing recycled the browser - and every single item page fetch
  // afterward then hung for the full 90s timeout, one after another,
  // against that same still-degraded instance. Two independent signals of
  // "this browser is bad, not just this one page": our own outer timeout
  // firing at all (nothing legitimate should still be running after 90s),
  // or the fetch itself reporting Chromium's own fatal, page-independent
  // failures rather than an ordinary navigation/HTTP error.
  const browserFatal =
    !result.success && !!result.error && /page crashed|target closed|browser has been closed/i.test(result.error);
  if (timedOut || browserFatal) await closeBrowser().catch(() => undefined);

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

  const visited = new Set<string>();
  const queue: { url: string; depth: number }[] = [{ url: new URL(url).toString(), depth: 0 }];
  let completed = 0;
  const errors: string[] = [];
  let cancelled = false;

  // Cancelling a job that's still 'queued' (BullMQ hasn't picked it up
  // yet) or already 'paused' when this worker function starts is handled
  // the same way as a mid-run cancel below - just before any work happens
  // instead of after some of it already has.
  if ((await getJobStatus(jobId)) === 'cancelled') return;

  await updateJobProgress(jobId, Math.min(limit, 1), 0);

  while (queue.length > 0 && visited.size < limit) {
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

    const next = queue.shift()!;
    if (visited.has(next.url)) continue;
    visited.add(next.url);

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
      `[crawlWorker] job ${jobId} fetching ${next.url} (depth ${next.depth}, ${completed}/${limit} done, ${queue.length} queued)`,
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
      console.log(`[crawlWorker] job ${jobId} failed ${next.url}: ${result.error}`);
      if (isItem) {
        errors.push(`${next.url}: ${result.error}`);
        await recordPageResult(siteId, jobId, next.url, result);
      }
    } else {
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
          await recordPageResult(siteId, jobId, next.url, result);
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
        for (const link of newLinks) {
          queue.push({ url: link, depth: next.depth + 1 });
        }
      }
    }

    await updateJobProgress(jobId, Math.min(limit, visited.size + queue.length), completed);

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
    [jobId, visited.size, completed, errors.length, JSON.stringify(errors.map((e) => ({ message: e }))), finalStatus],
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
  });
  return worker;
}
