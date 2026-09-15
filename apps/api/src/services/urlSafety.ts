import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

export class UnsafeUrlError extends Error {}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/** Loopback, link-local (includes 169.254.169.254 cloud metadata), private, and unspecified ranges. */
function isDisallowedIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // private
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
    if (a === 0) return true; // unspecified / "this network"
    return false;
  }

  const lower = ip.toLowerCase();
  if (lower.startsWith('::ffff:')) return isDisallowedIp(lower.slice(7));
  if (lower === '::' || lower === '::1') return true; // unspecified / loopback
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true; // link-local fe80::/10
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local fc00::/7
  return false;
}

/**
 * Rejects any URL that isn't a plain http(s) URL, or that resolves to a
 * loopback/private/link-local address (including the 169.254.169.254 cloud
 * metadata endpoint) - guards every outbound fetch against SSRF via
 * scheme confusion (file://, etc.) or an internal-network target.
 */
export async function assertSafeUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError(`Invalid URL: ${rawUrl}`);
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new UnsafeUrlError(
      `URL scheme "${url.protocol}" is not allowed - only http/https URLs may be fetched`,
    );
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(hostname)) {
    if (isDisallowedIp(hostname)) {
      throw new UnsafeUrlError(`URL host "${hostname}" is a private/internal address`);
    }
    return url;
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new UnsafeUrlError(`Could not resolve host "${hostname}"`);
  }
  for (const { address } of addresses) {
    if (isDisallowedIp(address)) {
      throw new UnsafeUrlError(
        `URL host "${hostname}" resolves to a private/internal address (${address})`,
      );
    }
  }
  return url;
}

/**
 * fetch() wrapper that validates the target (and every redirect hop) is a
 * public http(s) address before following it - `fetch`'s own
 * `redirect: 'follow'` does not re-validate hosts between hops, which would
 * otherwise let a malicious/compromised site redirect the crawler internally.
 */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  maxRedirects = 5,
): Promise<Response> {
  let currentUrl = rawUrl;
  for (let i = 0; i <= maxRedirects; i++) {
    await assertSafeUrl(currentUrl);
    const res = await fetch(currentUrl, { ...init, redirect: 'manual' });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    return res;
  }
  throw new UnsafeUrlError(`Too many redirects fetching ${rawUrl}`);
}
