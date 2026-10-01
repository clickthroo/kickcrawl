import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { profileFilterConditions, type ItemFilters } from '../src/routes/admin/urls.js';

describe('profileFilterConditions', () => {
  it('returns no conditions and adds no params when nothing is filtered', () => {
    const params: unknown[] = [];
    expect(profileFilterConditions({}, params)).toEqual([]);
    expect(params).toEqual([]);
  });

  it('matches stock_status exactly, not as a substring', () => {
    const params: unknown[] = [];
    const conditions = profileFilterConditions({ stock_status: 'In Stock' }, params);
    expect(conditions).toEqual(['u.stock_status = $1']);
    expect(params).toEqual(['In Stock']);
  });

  it('matches team/season/shirt_type/size/manufacturer/condition as a case-insensitive substring, the same way the "Path contains" filter already works', () => {
    const params: unknown[] = [];
    const conditions = profileFilterConditions({ team: 'Arsenal' }, params);
    expect(conditions).toEqual(['u.team ILIKE $1']);
    expect(params).toEqual(['%Arsenal%']);
  });

  it('maps the "number" filter to the player_number column, not a bare "number" one', () => {
    const params: unknown[] = [];
    const conditions = profileFilterConditions({ number: '10' }, params);
    expect(conditions).toEqual(['u.player_number ILIKE $1']);
    expect(params).toEqual(['%10%']);
  });

  it('matches a colour filter against either colour or colour_secondary with a single shared param, the same OR behaviour the old in-JS filter had', () => {
    const params: unknown[] = [];
    const conditions = profileFilterConditions({ colour: 'Yellow' }, params);
    expect(conditions).toEqual(['(u.colour ILIKE $1 OR u.colour_secondary ILIKE $1)']);
    expect(params).toEqual(['%Yellow%']);
  });

  it('combines every active filter, numbering params in order and reusing the same params array a caller already started filling', () => {
    const params: unknown[] = ['existing-site-id'];
    const filters: ItemFilters = {
      stock_status: 'Out of Stock',
      team: 'Arsenal',
      manufacturer: 'Adidas',
    };
    const conditions = profileFilterConditions(filters, params);
    expect(conditions).toEqual([
      'u.stock_status = $2',
      'u.team ILIKE $3',
      'u.manufacturer ILIKE $4',
    ]);
    expect(params).toEqual(['existing-site-id', 'Out of Stock', '%Arsenal%', '%Adidas%']);
  });
});

describe('POST /api/admin/urls/:id/test-list-on-kickio', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.doUnmock('../src/db.js');
    vi.doUnmock('../src/middleware/adminAuth.js');
    vi.doUnmock('../src/lib/kickioListingSync.js');
    vi.doUnmock('../src/services/kickioProfile.js');
    vi.doUnmock('../src/lib/currencyRates.js');
    vi.doUnmock('../src/lib/kickioTeams.js');
  });

  const SCRAPED_ROW = {
    id: 'url-1',
    url: 'https://www.vintagefootballshirts.com/products/man-utd-2012-13-away',
    preview_title: '2012-13 Manchester United Nike Away Shirt *BNIB* M',
    preview_image: 'https://img/1.jpg',
    preview_images: ['https://img/1.jpg'],
    preview_extracted: { team: 'Manchester United' },
    preview_markdown: 'In stock',
    last_fetched_at: '2026-09-29T00:00:00Z',
  };

  it('404s for an unknown url', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/middleware/adminAuth.js', () => ({ requireAdminSession: async () => undefined }));

    const { adminUrlRoutes } = await import('../src/routes/admin/urls.js');
    const app = Fastify();
    await app.register(adminUrlRoutes);

    const res = await app.inject({ method: 'POST', url: '/api/admin/urls/missing/test-list-on-kickio' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('refuses an item with nothing scraped yet', async () => {
    const query = vi.fn(async () => ({
      rows: [{ ...SCRAPED_ROW, preview_title: null, preview_extracted: null, preview_markdown: null }],
    }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/middleware/adminAuth.js', () => ({ requireAdminSession: async () => undefined }));

    const { adminUrlRoutes } = await import('../src/routes/admin/urls.js');
    const app = Fastify();
    await app.register(adminUrlRoutes);

    const res = await app.inject({ method: 'POST', url: '/api/admin/urls/url-1/test-list-on-kickio' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/nothing scraped/i);
    await app.close();
  });

  it('builds a profile from cached scrape data (no re-scrape) and passes it to syncListingAndPersistOutcome', async () => {
    const query = vi.fn(async () => ({ rows: [SCRAPED_ROW] }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/middleware/adminAuth.js', () => ({ requireAdminSession: async () => undefined }));
    vi.doMock('../src/lib/currencyRates.js', () => ({ getCurrencyRates: vi.fn(async () => ({})) }));
    vi.doMock('../src/lib/kickioTeams.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/lib/kickioTeams.js')>();
      return { ...actual, getKickioTeamsForMatching: vi.fn(async () => null) };
    });

    const syncListingAndPersistOutcome = vi.fn(async () => ({
      success: true,
      listingId: 'listing-1',
      action: 'insert',
      status: 'pending_review',
      priceChanged: false,
    }));
    vi.doMock('../src/lib/kickioListingSync.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/lib/kickioListingSync.js')>();
      return { ...actual, syncListingAndPersistOutcome };
    });

    const { adminUrlRoutes } = await import('../src/routes/admin/urls.js');
    const app = Fastify();
    await app.register(adminUrlRoutes);

    const res = await app.inject({ method: 'POST', url: '/api/admin/urls/url-1/test-list-on-kickio' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.outcome).toEqual({
      success: true,
      listingId: 'listing-1',
      action: 'insert',
      status: 'pending_review',
      priceChanged: false,
    });

    expect(syncListingAndPersistOutcome).toHaveBeenCalledTimes(1);
    const [urlIdArg, profileArg] = syncListingAndPersistOutcome.mock.calls[0];
    expect(urlIdArg).toBe('url-1');
    expect(profileArg.source.url).toBe(SCRAPED_ROW.url);
    expect(profileArg.identity.team).toBe('Manchester United');
    await app.close();
  });
});
