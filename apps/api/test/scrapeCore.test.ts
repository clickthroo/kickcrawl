import { beforeEach, describe, expect, it, vi } from 'vitest';

const SIMPLE_HTML = '<html><head><title>t</title></head><body>hi</body></html>';

function fetchPageMock() {
  return vi.fn(async () => ({
    html: SIMPLE_HTML,
    statusCode: 200,
    usedBrowser: true,
    finalUrl: 'https://example.com/',
    blocked: false,
  }));
}

describe('scrapePage - default waitFor for browser-rendered pages', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('applies a default wait when useBrowser is true and the caller gave no waitFor - the Vinted case: a JS SPA is still fetching its real results at domcontentloaded', async () => {
    const fetchPage = fetchPageMock();
    vi.doMock('../src/services/fetcher.js', () => ({ fetchPage }));

    const { scrapePage } = await import('../src/lib/scrapeCore.js');
    await scrapePage('https://example.com/', { useBrowser: true }, null);

    expect(fetchPage).toHaveBeenCalledWith(
      'https://example.com/',
      expect.objectContaining({ useBrowser: true, waitFor: 2_000 }),
    );
  });

  it('never overrides an explicit waitFor', async () => {
    const fetchPage = fetchPageMock();
    vi.doMock('../src/services/fetcher.js', () => ({ fetchPage }));

    const { scrapePage } = await import('../src/lib/scrapeCore.js');
    await scrapePage('https://example.com/', { useBrowser: true, waitFor: 500 }, null);

    expect(fetchPage).toHaveBeenCalledWith(
      'https://example.com/',
      expect.objectContaining({ useBrowser: true, waitFor: 500 }),
    );
  });

  it('stays at 0 for the plain HTTP path - only a browser-rendered page needs this', async () => {
    const fetchPage = fetchPageMock();
    vi.doMock('../src/services/fetcher.js', () => ({ fetchPage }));

    const { scrapePage } = await import('../src/lib/scrapeCore.js');
    await scrapePage('https://example.com/', {}, null);

    expect(fetchPage).toHaveBeenCalledWith(
      'https://example.com/',
      expect.objectContaining({ useBrowser: false, waitFor: 0 }),
    );
  });

  it('picks up use_browser_default from the site config the same way', async () => {
    const fetchPage = fetchPageMock();
    vi.doMock('../src/services/fetcher.js', () => ({ fetchPage }));

    const { scrapePage } = await import('../src/lib/scrapeCore.js');
    await scrapePage('https://example.com/', {}, {
      id: 's1',
      name: 'Site',
      base_url: 'https://example.com',
      rate_limit_rps: 1,
      max_depth: 2,
      use_browser_default: true,
      use_proxy: false,
      default_selectors: {},
      allowed_paths: [],
      denied_paths: [],
      is_active: true,
      require_pro_seller: false,
      min_seller_feedback: null,
    } as never);

    expect(fetchPage).toHaveBeenCalledWith(
      'https://example.com/',
      expect.objectContaining({ useBrowser: true, waitFor: 2_000 }),
    );
  });
});
