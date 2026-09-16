import { beforeEach, describe, expect, it, vi } from 'vitest';

function mockRobotsTxt(body: string) {
  vi.doMock('../src/services/urlSafety.js', () => ({
    safeFetch: vi.fn(async () => new Response(body, { status: 200 })),
  }));
}

describe('getCrawlDelay', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('caps an extreme robots.txt Crawl-delay so it cannot freeze the rate limiter', async () => {
    // Sites actively deterring scrapers sometimes set a Crawl-delay of
    // minutes (or more) specifically to make automated crawling
    // impractical - honoring it verbatim turned "slow down" into "this
    // job is now stuck for as long as the site's robots.txt says".
    mockRobotsTxt('User-agent: *\nCrawl-delay: 600\n');

    const { getCrawlDelay } = await import('../src/services/robots.js');
    const delay = await getCrawlDelay('https://example.com/', 'KickcrawlBot/1.0');
    expect(delay).toBe(30);
  });

  it('passes through a reasonable Crawl-delay unchanged', async () => {
    mockRobotsTxt('User-agent: *\nCrawl-delay: 5\n');

    const { getCrawlDelay } = await import('../src/services/robots.js');
    const delay = await getCrawlDelay('https://example.com/', 'KickcrawlBot/1.0');
    expect(delay).toBe(5);
  });

  it('returns undefined when robots.txt has no Crawl-delay directive', async () => {
    mockRobotsTxt('User-agent: *\nDisallow: /admin\n');

    const { getCrawlDelay } = await import('../src/services/robots.js');
    const delay = await getCrawlDelay('https://example.com/', 'KickcrawlBot/1.0');
    expect(delay).toBeUndefined();
  });
});
