import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

describe('crawlRoutes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.doUnmock('../src/db.js');
    vi.doUnmock('../src/queue.js');
    vi.doUnmock('../src/lib/siteResolver.js');
  });

  it('POST /api/v1/crawl tags the created job with the calling API key', async () => {
    const query = vi.fn(async () => ({ rows: [{ id: 'job-1' }] }));
    const add = vi.fn(async () => undefined);
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/queue.js', () => ({ crawlQueue: { add } }));
    vi.doMock('../src/lib/siteResolver.js', () => ({
      getOrCreateSiteForUrl: vi.fn(async () => ({ id: 'site-1' })),
    }));

    const { crawlRoutes } = await import('../src/routes/crawl.js');
    const app = Fastify();
    app.addHook('preHandler', async (req) => {
      (req as unknown as { apiKeyId: string }).apiKeyId = 'key-1';
    });
    await app.register(crawlRoutes);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/crawl',
      payload: { url: 'https://example.com' },
    });

    expect(res.statusCode).toBe(200);
    const insertCall = query.mock.calls.find(([sql]) => (sql as string).includes('INSERT INTO jobs'));
    expect(insertCall?.[1]).toEqual(['crawl', 'site-1', expect.any(String), 'queued', 'key-1']);
    expect(add).toHaveBeenCalledOnce();
    await app.close();
  });

  it("GET /api/v1/crawl/:jobId 404s for a job that isn't this key's own - the cross-tenant leak an audit flagged, now fixed", async () => {
    // Empty result simulates the exact scenario that was previously
    // exploitable: a job that exists but belongs to a different API key
    // (or was created internally with no api_key_id at all).
    const query = vi.fn(async () => ({ rows: [] }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/queue.js', () => ({ crawlQueue: { add: vi.fn() } }));

    const { crawlRoutes } = await import('../src/routes/crawl.js');
    const app = Fastify();
    app.addHook('preHandler', async (req) => {
      (req as unknown as { apiKeyId: string }).apiKeyId = 'key-2';
    });
    await app.register(crawlRoutes);

    const res = await app.inject({ method: 'GET', url: '/api/v1/crawl/someone-elses-job' });

    expect(res.statusCode).toBe(404);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('api_key_id = $2');
    expect(params).toEqual(['someone-elses-job', 'key-2']);
    await app.close();
  });

  it('GET /api/v1/crawl/:jobId returns the job when it does belong to the calling key', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM jobs')) {
        return {
          rows: [{ id: 'job-1', status: 'completed', completed_pages: 3, total_pages: 3, errors: [] }],
        };
      }
      return { rows: [] };
    });
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/queue.js', () => ({ crawlQueue: { add: vi.fn() } }));

    const { crawlRoutes } = await import('../src/routes/crawl.js');
    const app = Fastify();
    app.addHook('preHandler', async (req) => {
      (req as unknown as { apiKeyId: string }).apiKeyId = 'key-1';
    });
    await app.register(crawlRoutes);

    const res = await app.inject({ method: 'GET', url: '/api/v1/crawl/job-1' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.status).toBe('completed');
    await app.close();
  });
});
