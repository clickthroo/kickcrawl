import type { Page } from 'playwright';
import { ACCEPT_HEADER, ACCEPT_LANGUAGE, randomUserAgent } from './userAgents.js';
import { isBlockPage } from './blockDetector.js';
import { getBrowser, withBrowserSlot } from './browser.js';
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

async function fetchWithBrowser(
  url: string,
  userAgent: string,
  waitFor: number,
  proxyUrl?: string,
): Promise<FetchResult> {
  return withBrowserSlot(async () => {
    const browser = await getBrowser();
    const context = await browser.newContext({
      userAgent,
      locale: 'en-GB',
      proxy: proxyUrl ? { server: proxyUrl } : undefined,
    });
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
      return {
        html,
        statusCode,
        usedBrowser: true,
        finalUrl: page.url(),
        blocked: isBlockPage(statusCode, html),
      };
    } finally {
      await context.close();
    }
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
