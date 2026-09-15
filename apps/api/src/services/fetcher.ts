import { ACCEPT_HEADER, ACCEPT_LANGUAGE, randomUserAgent } from './userAgents.js';
import { isBlockPage } from './blockDetector.js';
import { getBrowser } from './browser.js';
import { acquireSlot } from './rateLimiter.js';
import { getCrawlDelay, isAllowedByRobots } from './robots.js';
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

async function fetchWithHttp(url: string, userAgent: string): Promise<FetchResult> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': userAgent,
      Accept: ACCEPT_HEADER,
      'Accept-Language': ACCEPT_LANGUAGE,
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  const html = await res.text();
  return {
    html,
    statusCode: res.status,
    usedBrowser: false,
    finalUrl: res.url || url,
    blocked: isBlockPage(res.status, html),
  };
}

async function fetchWithBrowser(
  url: string,
  userAgent: string,
  waitFor: number,
  proxyUrl?: string,
): Promise<FetchResult> {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent,
    locale: 'en-GB',
    proxy: proxyUrl ? { server: proxyUrl } : undefined,
  });
  try {
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    if (waitFor > 0) await page.waitForTimeout(waitFor);
    const html = await page.content();
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
}

/**
 * Fetches a page, respecting robots.txt and per-domain rate limits. Uses a
 * fast plain HTTP request first unless useBrowser is requested; if that
 * request is blocked (403/challenge page), retries once via Playwright.
 */
export async function fetchPage(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
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
    const result = await fetchWithHttp(url, userAgent);
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
