import type { Browser } from 'playwright';
import { config } from '../config.js';

let browserPromise: Promise<Browser> | null = null;

async function launchBrowser(): Promise<Browser> {
  const { chromium } = await import('playwright');
  return chromium.launch({
    headless: true,
    executablePath: config.playwrightExecutablePath || undefined,
    args: ['--disable-blink-features=AutomationControlled'],
  });
}

export function getBrowser(): Promise<Browser> {
  if (!browserPromise) browserPromise = launchBrowser();
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  if (browserPromise) {
    const browser = await browserPromise;
    await browser.close();
    browserPromise = null;
  }
}
