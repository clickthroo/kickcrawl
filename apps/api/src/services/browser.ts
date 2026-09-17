import type { Browser } from 'playwright';
import { config } from '../config.js';

let browserPromise: Promise<Browser> | null = null;

// chromium.launch() has no timeout of its own - a broken environment (a
// missing/mismatched browser build, a container that can't sandbox
// Chromium) can otherwise hang indefinitely, and since the launch is
// memoized below, that hang would silently block every future
// browser-dependent fetch for the rest of this process's life, not just
// the one request that triggered it.
const LAUNCH_TIMEOUT_MS = 20_000;

async function launchBrowser(): Promise<Browser> {
  const { chromium } = await import('playwright');
  const launch = chromium.launch({
    headless: true,
    executablePath: config.playwrightExecutablePath || undefined,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  return await Promise.race([
    launch,
    new Promise<Browser>((_, reject) =>
      setTimeout(() => reject(new Error(`chromium.launch() timed out after ${LAUNCH_TIMEOUT_MS}ms`)), LAUNCH_TIMEOUT_MS),
    ),
  ]);
}

export function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    // Clear the memoized promise on failure so a transient/one-off launch
    // problem doesn't permanently poison every later attempt - the next
    // caller gets a fresh try instead of the same cached rejection forever.
    browserPromise = launchBrowser().catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  // Clear the memoized reference before even attempting to close - a
  // browser we're recovering from is, by definition, one whose close()
  // call can itself throw (Playwright throws "Target closed"/"Browser has
  // been closed" against an already-crashed browser). Confirmed in
  // production: that throw used to skip the reset entirely, leaving every
  // later getBrowser() call return the SAME dead instance forever - every
  // fetch after the first crash failed immediately against a browser that
  // was never actually replaced, until the whole container got killed and
  // restarted.
  const promise = browserPromise;
  browserPromise = null;
  try {
    const browser = await promise;
    await browser.close();
  } catch {
    // Already gone - nothing left to close, and the reset above already
    // guarantees the next getBrowser() launches a fresh instance.
  }
}

/**
 * Caps how many browser-driven page loads run at once, across every caller
 * that shares this process's single memoized Chromium instance - the
 * crawl worker (concurrency: 3), the recheck worker, and manual scrape/
 * extract requests can all be mid-fetch simultaneously, and each one holds
 * a full rendered page (page.content()) plus whatever a JS-heavy site's own
 * bundle allocates. Verified in production: running Vinted's catalog page
 * (needs a real browser - it's a JS-rendered SPA) alongside just a couple
 * of other concurrent browser fetches repeatedly crashed the container
 * with a V8 "JavaScript heap out of memory" FATAL ERROR - this isn't a
 * guess at a possible problem, it's a fix for one that was already
 * reproducing. 1 is deliberately conservative: a crash that kills every
 * in-flight job is far worse than crawls running one page slower.
 */
const MAX_CONCURRENT_BROWSER_FETCHES = 1;
let activeBrowserFetches = 0;
const waiters: (() => void)[] = [];

export async function withBrowserSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeBrowserFetches >= MAX_CONCURRENT_BROWSER_FETCHES) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  activeBrowserFetches++;
  try {
    return await fn();
  } finally {
    activeBrowserFetches--;
    const next = waiters.shift();
    if (next) next();
  }
}
