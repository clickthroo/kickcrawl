import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProxyAgent } from 'undici';
import { assertSafeUrl, safeFetch, UnsafeUrlError } from '../src/services/urlSafety.js';

describe('assertSafeUrl', () => {
  it('rejects non-http(s) schemes', async () => {
    await expect(assertSafeUrl('file:///etc/passwd')).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeUrl('ftp://example.com/x')).rejects.toThrow(UnsafeUrlError);
  });

  it('rejects loopback addresses', async () => {
    await expect(assertSafeUrl('http://127.0.0.1/')).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeUrl('http://localhost/')).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeUrl('http://[::1]/')).rejects.toThrow(UnsafeUrlError);
  });

  it('rejects the cloud metadata / link-local range', async () => {
    await expect(assertSafeUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(
      UnsafeUrlError,
    );
  });

  it('rejects RFC1918 private ranges', async () => {
    await expect(assertSafeUrl('http://10.0.0.5/')).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeUrl('http://172.16.0.1/')).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeUrl('http://192.168.1.1/')).rejects.toThrow(UnsafeUrlError);
  });

  it('allows a normal public https URL', async () => {
    await expect(assertSafeUrl('https://93.184.216.34/')).resolves.toBeInstanceOf(URL);
  });

  it('rejects an unresolvable hostname', async () => {
    await expect(
      assertSafeUrl('http://this-host-should-never-resolve.invalid/'),
    ).rejects.toThrow(UnsafeUrlError);
  });
});

describe('assertSafeUrl DNS lookup timeout', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('fails closed instead of hanging forever when the DNS lookup never resolves', async () => {
    // dns.promises.lookup() has no timeout of its own - a hung resolver
    // for a real domain would otherwise freeze every fetch (and every
    // redirect hop, and the robots.txt check) that goes through
    // assertSafeUrl indefinitely, which is exactly what happened in
    // production. Mock it to never resolve and confirm assertSafeUrl
    // still rejects within its own bounded timeout rather than hanging.
    vi.useFakeTimers();
    vi.doMock('node:dns/promises', () => ({ lookup: () => new Promise(() => {}) }));

    const { assertSafeUrl: assertSafeUrlFresh, UnsafeUrlError: UnsafeUrlErrorFresh } = await import(
      '../src/services/urlSafety.js'
    );

    const pending = assertSafeUrlFresh('http://slow-dns-example.test/');
    const assertion = expect(pending).rejects.toThrow(UnsafeUrlErrorFresh);
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });
});

describe('safeFetch proxy support', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // A real public IP, so assertSafeUrl's DNS check passes without a real
    // network call - mirrors the "allows a normal public https URL" case.
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));
  });

  it('routes the request through a ProxyAgent when a proxyUrl is given', async () => {
    // Node's global fetch has no proxy support of its own - a site's own
    // geolocation (e.g. Shopify Markets picking a currency from the
    // request's IP) otherwise always sees wherever this server is hosted,
    // never the region a real customer would actually be browsing from.
    await safeFetch('https://93.184.216.34/', {}, 5, 'http://proxy.example:8080');

    expect(fetch).toHaveBeenCalledTimes(1);
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect((init as { dispatcher?: unknown }).dispatcher).toBeInstanceOf(ProxyAgent);
  });

  it('passes no dispatcher when no proxyUrl is given', async () => {
    await safeFetch('https://93.184.216.34/');

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect((init as { dispatcher?: unknown }).dispatcher).toBeUndefined();
  });

  it('reuses the same ProxyAgent across calls to the same proxy URL', async () => {
    await safeFetch('https://93.184.216.34/', {}, 5, 'http://proxy.example:8080');
    await safeFetch('https://93.184.216.34/', {}, 5, 'http://proxy.example:8080');

    const [[, firstInit], [, secondInit]] = vi.mocked(fetch).mock.calls;
    expect((firstInit as { dispatcher?: unknown }).dispatcher).toBe(
      (secondInit as { dispatcher?: unknown }).dispatcher,
    );
  });
});
