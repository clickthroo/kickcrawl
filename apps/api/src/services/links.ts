import type { CheerioAPI } from 'cheerio';

/** Resolves every <a href> on the page to an absolute URL, deduped, dropping mailto/tel/javascript links. */
export function extractLinks($: CheerioAPI, pageUrl: string): string[] {
  const links = new Set<string>();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const trimmed = href.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    if (/^(mailto|tel|javascript):/i.test(trimmed)) return;
    try {
      const abs = new URL(trimmed, pageUrl);
      abs.hash = '';
      links.add(abs.toString());
    } catch {
      // ignore unparsable hrefs
    }
  });
  return [...links];
}

function stripWww(hostname: string): string {
  return hostname.startsWith('www.') ? hostname.slice(4) : hostname;
}

/**
 * A bare domain and its "www." counterpart are treated as the same site
 * unconditionally - sites very commonly canonicalize sitemap/link URLs to
 * whichever of the two isn't what an admin typed as the base URL, and
 * without this a real sitemap's worth of URLs can silently filter down to
 * zero. includeSubdomains only controls genuinely distinct subdomains
 * (shop., blog., etc.) beyond that www/bare equivalence.
 */
export function isSameSite(url: string, baseOrigin: string, includeSubdomains: boolean): boolean {
  try {
    const u = new URL(url);
    const base = new URL(baseOrigin);
    const uHost = stripWww(u.hostname);
    const baseHost = stripWww(base.hostname);
    if (includeSubdomains) {
      return uHost === baseHost || uHost.endsWith(`.${baseHost}`);
    }
    return uHost === baseHost;
  } catch {
    return false;
  }
}

/** Matches a URL path against Firecrawl-style glob patterns like "/shirt/*" or "/cart". */
export function matchesPathPattern(path: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  const regex = new RegExp(`^${escaped}$`);
  return regex.test(path) || regex.test(path.replace(/\/$/, ''));
}

export function isPathAllowed(
  path: string,
  includePaths: string[] = [],
  excludePaths: string[] = [],
): boolean {
  if (excludePaths.some((p) => matchesPathPattern(path, p))) return false;
  if (includePaths.length > 0) return includePaths.some((p) => matchesPathPattern(path, p));
  return true;
}
