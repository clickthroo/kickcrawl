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

describe('scrapePage - skips the markdown/extraction pipeline when nothing needs it', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  // The real-world case this guards: a crawl's own link-discovery pages
  // (Vinted's catalog/search listings, which are never themselves items)
  // only ever request 'links' - getContentHtml/htmlToMarkdown/
  // extractBySelectors/extractStructuredProductData running anyway for
  // those was real, confirmed-in-production memory cost for content
  // nothing ever reads.
  async function importWithMocks() {
    vi.doMock('../src/services/fetcher.js', () => ({ fetchPage: fetchPageMock() }));
    const getContentHtml = vi.fn(() => '<p>content</p>');
    const htmlToMarkdown = vi.fn(() => 'markdown');
    const extractBySelectors = vi.fn(() => ({}));
    const extractStructuredProductData = vi.fn(() => ({
      price: null,
      currency: null,
      availability: null,
      sku: null,
    }));
    vi.doMock('../src/services/mainContent.js', () => ({ getContentHtml }));
    vi.doMock('../src/services/markdown.js', () => ({ htmlToMarkdown }));
    vi.doMock('../src/services/extractor.js', () => ({ extractBySelectors }));
    vi.doMock('../src/services/structuredData.js', () => ({ extractStructuredProductData }));
    const { scrapePage } = await import('../src/lib/scrapeCore.js');
    return { scrapePage, getContentHtml, htmlToMarkdown, extractBySelectors, extractStructuredProductData };
  }

  it('never runs getContentHtml/htmlToMarkdown/extraction when only links are requested', async () => {
    const { scrapePage, getContentHtml, htmlToMarkdown, extractBySelectors, extractStructuredProductData } =
      await importWithMocks();

    const result = await scrapePage('https://example.com/', { formats: ['links'] }, null);

    expect(getContentHtml).not.toHaveBeenCalled();
    expect(htmlToMarkdown).not.toHaveBeenCalled();
    expect(extractBySelectors).not.toHaveBeenCalled();
    expect(extractStructuredProductData).not.toHaveBeenCalled();
    expect(result.markdown).toBeUndefined();
    expect(result.html).toBeUndefined();
    expect(result.extracted).toBeUndefined();
  });

  it('still runs the full pipeline when markdown is requested', async () => {
    const { scrapePage, getContentHtml, htmlToMarkdown, extractStructuredProductData } = await importWithMocks();

    const result = await scrapePage('https://example.com/', { formats: ['markdown', 'links'] }, null);

    expect(getContentHtml).toHaveBeenCalled();
    expect(htmlToMarkdown).toHaveBeenCalled();
    expect(extractStructuredProductData).toHaveBeenCalled();
    expect(result.markdown).toBe('markdown');
  });

  it('runs the pipeline for html-only requests too, since it also depends on getContentHtml', async () => {
    const { scrapePage, getContentHtml } = await importWithMocks();

    await scrapePage('https://example.com/', { formats: ['html'] }, null);

    expect(getContentHtml).toHaveBeenCalled();
  });
});
