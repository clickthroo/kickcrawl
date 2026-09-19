import type { Page } from 'playwright';
import { ACCEPT_HEADER, ACCEPT_LANGUAGE, randomUserAgent } from './userAgents.js';
import { isBlockPage } from './blockDetector.js';
import { closeBrowser, getBrowser, withBrowserSlot } from './browser.js';
import { acquireSlot } from './rateLimiter.js';
import { getCrawlDelay, isAllowedByRobots } from './robots.js';
import { assertSafeUrl, safeFetch, UnsafeUrlError } from './urlSafety.js';
import { config } from '../config.js';

export interface FetchOptions {
  useBrowser?: boolean;
  waitFor?: number;
  proxyUrl?: string;
  rateLimitRps?: number;
  respectRobots?: boolean;
  userAgent?: string;
}

export interface FetchResult {
  html: string;
  statusCode: number;
  usedBrowser: boolean;
  finalUrl: string;
  blocked: boolean;
  error?: string;
}

async function fetchWithHttp(url: string, userAgent: string, proxyUrl?: string): Promise<FetchResult> {
  const res = await safeFetch(
    url,
    {
      headers: {
        'User-Agent': userAgent,
        Accept: ACCEPT_HEADER,
        'Accept-Language': ACCEPT_LANGUAGE,
      },
      signal: AbortSignal.timeout(20_000),
    },
    5,
    proxyUrl,
  );
  const html = await res.text();
  return {
    html,
    statusCode: res.status,
    usedBrowser: false,
    finalUrl: res.url || url,
    blocked: isBlockPage(res.status, html),
  };
}

export interface GuardNavigationOptions {
  /**
   * Drop image/media/font requests outright instead of letting Chromium
   * fetch and decode them. A scrape only ever reads the DOM/text and
   * whatever URLs a page's own meta tags carry (e.g. og:image) - it never
   * needs the actual rendered pixels - so for scraping this is pure
   * memory/bandwidth cost with no upside, and it's the single biggest
   * driver on an image-grid page like a marketplace catalog (dozens of
   * listing thumbnails). Screenshots (routes/screenshot.ts) are the one
   * real exception - they need the actual images rendered - so this
   * defaults to false and is only turned on for the scraping path.
   */
  blockMedia?: boolean;
}

const BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font']);

/**
 * Blocks navigation (including server-side redirects Chromium follows on
 * its own) to anything but a validated public http(s) URL - `page.goto`
 * alone would happily follow a redirect chain into a private address even
 * when the original URL was safe.
 */
export async function guardNavigation(page: Page, opts: GuardNavigationOptions = {}): Promise<void> {
  await page.route('**/*', async (route) => {
    const request = route.request();
    const resourceType = request.resourceType();
    if (opts.blockMedia && BLOCKED_RESOURCE_TYPES.has(resourceType)) {
      await route.abort();
      return;
    }
    if (resourceType !== 'document') {
      await route.continue();
      return;
    }
    try {
      await assertSafeUrl(request.url());
      await route.continue();
    } catch {
      await route.abort();
    }
  });
}

// page.goto() has its own 30s timeout, but browser.newContext(),
// context.newPage(), page.content() and context.close() do not - any one
// of them hanging against a wedged-but-not-crashed browser process (one
// that doesn't trip browser.ts's "page crashed"/"target closed" detection)
// left this whole function unable to ever settle. That's fatal beyond just
// this one page: withBrowserSlot's own accounting (services/browser.ts)
// only releases its single global slot once the callback passed to it
// settles, so a fetch that never settles here permanently deadlocks EVERY
// future browser-driven fetch across the whole app - every other crawl
// job, the recheck worker, manual scrapes - not just this one job. This
// was the real cause of a crawl repeatedly stalling at almost exactly the
// same page count regardless of max_depth, page limit or anything else
// touching how MANY pages there were to fetch - none of that matters once
// the one shared browser slot is stuck forever.
const BROWSER_FETCH_TIMEOUT_MS = 45_000;

export async function fetchWithBrowser(
  url: string,
  userAgent: string,
  waitFor: number,
  proxyUrl?: string,
): Promise<FetchResult> {
  return withBrowserSlot(async () => {
    const attempt = (async (): Promise<FetchResult> => {
      const browser = await getBrowser();
      const context = await browser.newContext({
        userAgent,
        locale: 'en-GB',
        proxy: proxyUrl ? { server: proxyUrl } : undefined,
      });
      let result: FetchResult;
      try {
        const page = await context.newPage();
        await guardNavigation(page, { blockMedia: true });
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        if (waitFor > 0) await page.waitForTimeout(waitFor);
        const html = await page.content();
        // Diagnostic for the repeated Vinted OOM crash - concurrency capping,
        // media blocking and single-parsing (all already shipped) haven't
        // stopped it, so before guessing a fourth time this pins down
        // whether the raw HTML itself is the thing that's actually huge.
        console.log(`[fetcher] browser-rendered ${url}: ${(html.length / 1_048_576).toFixed(2)}MB HTML`);
        const statusCode = response?.status() ?? 0;
        result = {
          html,
          statusCode,
          usedBrowser: true,
          finalUrl: page.url(),
          blocked: isBlockPage(statusCode, html),
        };
      } finally {
        // A close-time failure (the context/browser already gone - common
        // right after a recycle, or when the underlying browser process
        // hiccups) must never overwrite an already-successful result above
        // with a failure. Confirmed in production: with `return` inside the
        // try block, a page that had genuinely fetched and rendered fine
        // was still reported as failed the instant context.close() threw
        // "Protocol error: Failed to find context" or "Target page, context
        // or browser has been closed" - and since that second message also
        // matches scrapePageWithTimeout's browserFatal detection
        // (crawlWorker.ts), it triggered an unnecessary full browser
        // restart on nearly every single page, which then cascaded into
        // the NEXT page's own close() failing against the now-torn-down
        // browser too.
        await context.close().catch(() => undefined);
      }
      return result;
    })();

    return await Promise.race([
      attempt,
      new Promise<FetchResult>((_, reject) =>
        setTimeout(() => {
          // Treated as broken outright rather than trusted to recover on
          // its own - resets the memoized browser (services/browser.ts) so
          // the NEXT fetch gets a fresh instance instead of piling up
          // behind this same wedged one. The orphaned attempt above keeps
          // running in the background (nothing can truly cancel it), but
          // that no longer matters: this race settling is what lets
          // withBrowserSlot's own finally run and free the slot.
          closeBrowser().catch(() => undefined);
          reject(new Error(`Browser fetch timed out after ${BROWSER_FETCH_TIMEOUT_MS}ms fetching ${url}`));
        }, BROWSER_FETCH_TIMEOUT_MS),
      ),
    ]);
  });
}

/**
 * Fetches a page, respecting robots.txt and per-domain rate limits. Uses a
 * fast plain HTTP request first unless useBrowser is requested; if that
 * request is blocked (403/challenge page), retries once via Playwright.
 */
export async function fetchPage(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  try {
    await assertSafeUrl(url);
  } catch (err) {
    return {
      html: '',
      statusCode: 0,
      usedBrowser: false,
      finalUrl: url,
      blocked: false,
      error: err instanceof UnsafeUrlError ? err.message : 'Unsafe URL',
    };
  }

  const userAgent = opts.userAgent ?? config.defaultUserAgent;
  const domain = new URL(url).hostname;

  if (opts.respectRobots !== false) {
    const allowed = await isAllowedByRobots(url, userAgent);
    if (!allowed) {
      return {
        html: '',
        statusCode: 999,
        usedBrowser: false,
        finalUrl: url,
        blocked: false,
        error: 'Disallowed by robots.txt',
      };
    }
  }

  const crawlDelay = await getCrawlDelay(url, userAgent);
  await acquireSlot(domain, opts.rateLimitRps ?? 1, crawlDelay);

  if (opts.useBrowser) {
    try {
      return await fetchWithBrowser(url, randomUserAgent(), opts.waitFor ?? 0, opts.proxyUrl);
    } catch (err) {
      return {
        html: '',
        statusCode: 0,
        usedBrowser: true,
        finalUrl: url,
        blocked: false,
        error: err instanceof Error ? err.message : 'Browser fetch failed',
      };
    }
  }

  try {
    const result = await fetchWithHttp(url, userAgent, opts.proxyUrl);
    if (!result.blocked) return result;
    // Blocked - fall through to browser retry below.
  } catch (err) {
    // Network-level failure (timeout, DNS, TLS) - try the browser once
    // before giving up, since some sites reject plain HTTP clients outright.
  }

  await acquireSlot(domain, opts.rateLimitRps ?? 1, crawlDelay);
  try {
    return await fetchWithBrowser(url, randomUserAgent(), opts.waitFor ?? 0, opts.proxyUrl);
  } catch (err) {
    return {
      html: '',
      statusCode: 0,
      usedBrowser: true,
      finalUrl: url,
      blocked: false,
      error: err instanceof Error ? err.message : 'Fetch failed',
    };
  }
}
