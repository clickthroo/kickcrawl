import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('backfillBareInitialPlayerNames', () => {
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

  it('does nothing and makes no further queries when no rows match the bug signature', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));

    const { backfillBareInitialPlayerNames } = await import('../src/lib/backfillPlayerNames.js');
    const updated = await backfillBareInitialPlayerNames();

    expect(updated).toBe(0);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toMatch(/player_number IS NOT NULL AND player IS NULL/);
  });

  it('rebuilds the profile for each matching row and persists it, tracked items only', async () => {
    const targetsQuery = { rows: [{ id: 'url-1' }, { id: 'url-2' }] };
    const detailsQuery = {
      rows: [
        {
          id: 'url-1',
          url: 'https://www.footballfinery.co.uk/products/brazil-coutinho',
          last_fetched_at: '2026-09-30T00:00:00Z',
          title: '2016/17 Brazil Home Football Shirt (M) Nike #11 P. Coutinho',
          image: 'https://img/1.jpg',
          images: ['https://img/1.jpg'],
          extracted: null,
          markdown: 'Condition: Very Good.',
        },
        {
          id: 'url-2',
          url: 'https://www.footballfinery.co.uk/products/psg-cavani',
          last_fetched_at: '2026-09-30T00:00:00Z',
          title: '2013/14 PSG Home Shirt (M) Nike 9 Cavani',
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

    const { backfillBareInitialPlayerNames } = await import('../src/lib/backfillPlayerNames.js');
    const updated = await backfillBareInitialPlayerNames();

    expect(updated).toBe(2);
    expect(persistItemProfileColumns).toHaveBeenCalledTimes(2);

    const [url1Id, url1Profile] = persistItemProfileColumns.mock.calls[0];
    expect(url1Id).toBe('url-1');
    expect(url1Profile.identity.team).toBe('Brazil');
    expect(url1Profile.identity.player).toBe('P. Coutinho');
    expect(url1Profile.identity.number).toBe('11');

    const [url2Id, url2Profile] = persistItemProfileColumns.mock.calls[1];
    expect(url2Id).toBe('url-2');
    expect(url2Profile.identity.team).toBe('PSG');
    expect(url2Profile.identity.player).toBe('Cavani');

    // Only the two SELECTs (target ids, then this one batch's details) -
    // never a sales-table write or any Kickio call.
    expect(query).toHaveBeenCalledTimes(2);
  });
});
