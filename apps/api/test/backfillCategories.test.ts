import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('backfillItemCategories', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.doUnmock('../src/db.js');
    vi.doUnmock('../src/services/kickioProfile.js');
    vi.doUnmock('../src/lib/currencyRates.js');
    vi.doUnmock('../src/lib/kickioTeams.js');
    vi.doUnmock('../src/lib/persistItemProfile.js');
  });

  it('does nothing and makes no further queries when every row already has a category', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));

    const { backfillItemCategories } = await import('../src/lib/backfillCategories.js');
    const updated = await backfillItemCategories();

    expect(updated).toBe(0);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toMatch(/category IS NULL/);
  });

  it('rebuilds and persists the full profile for each row missing a category', async () => {
    const targetsQuery = { rows: [{ id: 'url-1' }, { id: 'url-2' }] };
    const detailsQuery = {
      rows: [
        {
          id: 'url-1',
          url: 'https://www.footballfinery.co.uk/products/arsenal-polo',
          last_fetched_at: '2026-09-30T00:00:00Z',
          title: 'Arsenal Nike Polo Shirt M',
          image: 'https://img/1.jpg',
          images: ['https://img/1.jpg'],
          extracted: null,
          markdown: 'Condition: Very Good.',
        },
        {
          id: 'url-2',
          url: 'https://www.footballfinery.co.uk/products/psg-home',
          last_fetched_at: '2026-09-30T00:00:00Z',
          title: '2013/14 PSG Home Shirt (M) Nike',
          image: 'https://img/2.jpg',
          images: ['https://img/2.jpg'],
          extracted: null,
          markdown: 'Condition: Excellent.',
        },
      ],
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce(targetsQuery)
      .mockResolvedValueOnce(detailsQuery);
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/lib/currencyRates.js', () => ({ getCurrencyRates: vi.fn(async () => ({})) }));
    vi.doMock('../src/lib/kickioTeams.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/lib/kickioTeams.js')>();
      return { ...actual, getKickioTeamsForMatching: vi.fn(async () => null) };
    });

    const persistItemProfileColumns = vi.fn(async () => undefined);
    vi.doMock('../src/lib/persistItemProfile.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/lib/persistItemProfile.js')>();
      return { ...actual, persistItemProfileColumns };
    });

    const { backfillItemCategories } = await import('../src/lib/backfillCategories.js');
    const updated = await backfillItemCategories();

    expect(updated).toBe(2);
    expect(persistItemProfileColumns).toHaveBeenCalledTimes(2);

    const [url1Id, url1Profile] = persistItemProfileColumns.mock.calls[0];
    expect(url1Id).toBe('url-1');
    expect(url1Profile.category).toBe('Polo Shirts & T-shirts');

    const [url2Id, url2Profile] = persistItemProfileColumns.mock.calls[1];
    expect(url2Id).toBe('url-2');
    expect(url2Profile.category).toBe('Football Shirts');

    // Only the two SELECTs (target ids, then this one batch's details) -
    // never a sales-table write or any Kickio call.
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('reports progress via onProgress as each row is updated', async () => {
    const targetsQuery = { rows: [{ id: 'url-1' }] };
    const detailsQuery = {
      rows: [
        {
          id: 'url-1',
          url: 'https://example.com/x',
          last_fetched_at: '2026-09-30T00:00:00Z',
          title: 'Arsenal Home Shirt',
          image: null,
          images: null,
          extracted: null,
          markdown: null,
        },
      ],
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce(targetsQuery)
      .mockResolvedValueOnce(detailsQuery);
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    vi.doMock('../src/lib/currencyRates.js', () => ({ getCurrencyRates: vi.fn(async () => ({})) }));
    vi.doMock('../src/lib/kickioTeams.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/lib/kickioTeams.js')>();
      return { ...actual, getKickioTeamsForMatching: vi.fn(async () => null) };
    });
    vi.doMock('../src/lib/persistItemProfile.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/lib/persistItemProfile.js')>();
      return { ...actual, persistItemProfileColumns: vi.fn(async () => undefined) };
    });

    const { backfillItemCategories } = await import('../src/lib/backfillCategories.js');
    const onProgress = vi.fn();
    await backfillItemCategories(onProgress);

    expect(onProgress).toHaveBeenCalledWith(1, 1);
  });
});
