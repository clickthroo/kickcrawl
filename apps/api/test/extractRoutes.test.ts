import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

describe('extractRoutes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.doUnmock('../src/db.js');
    vi.doUnmock('../src/services/fetcher.js');
    vi.doUnmock('../src/services/extractor.js');
    vi.doUnmock('../src/lib/siteResolver.js');
    vi.doUnmock('../src/lib/urlStore.js');
  });

  it('returns a cached result without fetching the page again', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT result FROM extract_cache')) {
        return { rows: [{ result: { title: 'Cached title' } }] };
      }
      return { rows: [] };
    });
    const fetchPage = vi.fn();
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/services/fetcher.js', () => ({ fetchPage }));

    const { extractRoutes } = await import('../src/routes/extract.js');
    const app = Fastify();
    await app.register(extractRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/extract',
      payload: { url: 'https://example.com/product', schema: { title: 'string' } },
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.cached).toBe(true);
    expect(body.json).toEqual({ title: 'Cached title' });
    expect(fetchPage).not.toHaveBeenCalled();
    await app.close();
  });

  it('fetches, extracts by the site\'s selectors, and caches the result on a cache miss', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT result FROM extract_cache')) return { rows: [] };
      return { rows: [] };
    });
    const fetchPage = vi.fn(async () => ({
      html: '<html><body><h1 class="title">Real title</h1></body></html>',
      finalUrl: 'https://example.com/product',
      statusCode: 200,
      usedBrowser: false,
      blocked: false,
    }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/services/fetcher.js', () => ({ fetchPage }));
    vi.doMock('../src/lib/siteResolver.js', () => ({
      resolveSiteForUrl: vi.fn(async () => ({
        id: 'site-1',
        use_browser_default: false,
        rate_limit_rps: 1,
        default_selectors: { title: 'h1.title' },
      })),
    }));
    vi.doMock('../src/lib/urlStore.js', () => ({ markUrlFetched: vi.fn(async () => 'url-1') }));

    const { extractRoutes } = await import('../src/routes/extract.js');
    const app = Fastify();
    await app.register(extractRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/extract',
      payload: { url: 'https://example.com/product', schema: { title: 'string' } },
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.json).toEqual({ title: 'Real title' });
    expect(fetchPage).toHaveBeenCalledOnce();
    const insertCall = query.mock.calls.find(([sql]) => (sql as string).includes('INSERT INTO extract_cache'));
    expect(insertCall).toBeTruthy();
    await app.close();
  });

  it('returns a 502 when the page fetch itself fails', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const fetchPage = vi.fn(async () => ({
      html: '',
      finalUrl: 'https://example.com/product',
      statusCode: 0,
      usedBrowser: false,
      blocked: false,
      error: 'Timed out',
    }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/services/fetcher.js', () => ({ fetchPage }));
    vi.doMock('../src/lib/siteResolver.js', () => ({ resolveSiteForUrl: vi.fn(async () => null) }));

    const { extractRoutes } = await import('../src/routes/extract.js');
    const app = Fastify();
    await app.register(extractRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/extract',
      payload: { url: 'https://example.com/product', schema: { title: 'string' } },
    });

    expect(res.statusCode).toBe(502);
    await app.close();
  });
});
