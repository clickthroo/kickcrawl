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
  if (browserPromise) {
    const browser = await browserPromise;
    await browser.close();
    browserPromise = null;
  }
}
