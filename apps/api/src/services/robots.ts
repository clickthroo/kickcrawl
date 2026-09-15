import robotsParser from 'robots-parser';
import { randomUserAgent } from './userAgents.js';
import { safeFetch } from './urlSafety.js';

interface Robot {
  isAllowed(url: string, userAgent: string): boolean | undefined;
  isDisallowed(url: string, userAgent: string): boolean | undefined;
  getCrawlDelay(userAgent: string): number | undefined;
  getSitemaps(): string[];
}

const cache = new Map<string, { robot: Robot | null; fetchedAt: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000;

async function fetchRobots(origin: string): Promise<Robot | null> {
  const url = `${origin}/robots.txt`;
  try {
    const res = await safeFetch(url, {
      headers: { 'User-Agent': randomUserAgent() },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    return robotsParser(url, text);
  } catch {
    return null;
  }
}

export async function getRobots(origin: string): Promise<Robot | null> {
  const cached = cache.get(origin);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.robot;
  const robot = await fetchRobots(origin);
  cache.set(origin, { robot, fetchedAt: Date.now() });
  return robot;
}

export async function isAllowedByRobots(url: string, userAgent: string): Promise<boolean> {
  try {
    const origin = new URL(url).origin;
    const robot = await getRobots(origin);
    if (!robot) return true;
    const allowed = robot.isAllowed(url, userAgent);
    return allowed !== false;
  } catch {
    return true;
  }
}

export async function getCrawlDelay(url: string, userAgent: string): Promise<number | undefined> {
  try {
    const origin = new URL(url).origin;
    const robot = await getRobots(origin);
    return robot?.getCrawlDelay(userAgent) ?? undefined;
  } catch {
    return undefined;
  }
}

export async function getSitemapUrls(origin: string): Promise<string[]> {
  const robot = await getRobots(origin);
  return robot?.getSitemaps() ?? [];
}
