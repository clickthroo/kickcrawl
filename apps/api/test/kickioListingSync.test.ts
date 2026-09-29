import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildKickioProfile } from '../src/services/kickioProfile.js';

const CONFIGURED = {
  kickioSupabaseUrl: 'https://example.supabase.co',
  kickioSupabaseServiceRoleKey: 'test-service-role-key',
};

async function loadModule(configOverrides: Partial<typeof CONFIGURED> = CONFIGURED) {
  vi.resetModules();
  vi.doMock('../src/config.js', () => ({ config: configOverrides }));
  return import('../src/lib/kickioListingSync.js');
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

// Same real listing shape as kickioSync.test.ts's own fixture - matched
// against a live Kickio team so team_kickio_match is populated, and with a
// price so buildListingPayload has something to send - unlike a completed
// sale, a live listing's price comes straight off the profile's own
// listing fields, not a separately-passed sale price.
function activeProfile(kickioTeams?: { name: string; slug: string; country?: string }[]) {
  return buildKickioProfile({
    url: 'https://www.vintagefootballshirts.com/products/man-utd-2012-13-away',
    title: '2012-13 Manchester United Nike Away Shirt *BNIB* M',
    images: ['https://www.vintagefootballshirts.com/img/shirt.jpg'],
    price: 90,
    currency: 'GBP',
    kickioTeams,
  });
}

describe('submitListingToKickio', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('../src/config.js');
  });

  it('holds - never calls Kickio - when there is no confident team match', async () => {
    const { submitListingToKickio } = await loadModule();
    const fetchSpy = vi.spyOn(global, 'fetch');

    const outcome = await submitListingToKickio('url-1', activeProfile());

    expect(outcome.success).toBe(false);
    expect(outcome.error).toMatch(/no confident kickio team match/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('holds when the profile has no price recorded', async () => {
    const { submitListingToKickio } = await loadModule();
    const fetchSpy = vi.spyOn(global, 'fetch');
    const teams = [{ name: 'Manchester United', slug: 'manchester-united', country: 'England' }];

    const profile = buildKickioProfile({
      url: 'https://www.vintagefootballshirts.com/products/man-utd-2012-13-away',
      title: '2012-13 Manchester United Nike Away Shirt *BNIB* M',
      kickioTeams: teams,
    });
    const outcome = await submitListingToKickio('url-1', profile);

    expect(outcome.success).toBe(false);
    expect(outcome.error).toMatch(/no price/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('calls ONLY import_kickio_listing, with the identity fields plus price/condition/size/quantity', async () => {
    const { submitListingToKickio } = await loadModule();
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      jsonResponse({ action: 'insert', listing_id: 'listing-123', status: 'pending', price_changed: false }),
    );
    const teams = [{ name: 'Manchester United', slug: 'manchester-united', country: 'England' }];

    const outcome = await submitListingToKickio('url-1', activeProfile(teams));

    expect(outcome).toEqual({
      success: true,
      listingId: 'listing-123',
      action: 'insert',
      status: 'pending',
      priceChanged: false,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('/rest/v1/rpc/import_kickio_listing');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.p.id).toBe('url-1');
    expect(body.p.team).toBe('Manchester United'); // team_kickio_match, not a raw guess
    expect(body.p.source_url).toBe('https://www.vintagefootballshirts.com/products/man-utd-2012-13-away');
    expect(body.p.price_cents).toBe(9000);
    expect(body.p.currency).toBe('GBP');
    expect(body.p.condition).toBe('Brand New (With Tags)');
    expect(body.p.size).toBe('M');
    expect(body.p.quantity).toBe(1);
  });

  it('surfaces a Kickio RPC error rather than swallowing it', async () => {
    const { submitListingToKickio } = await loadModule();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response('service unavailable', { status: 503, statusText: 'Service Unavailable' }),
    );
    const teams = [{ name: 'Manchester United', slug: 'manchester-united', country: 'England' }];

    await expect(submitListingToKickio('url-1', activeProfile(teams))).rejects.toThrow(
      /import_kickio_listing failed: 503/,
    );
  });
});

describe('delistListingFromKickio', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('../src/config.js');
  });

  it('throws KickioSyncNotConfiguredError instead of calling out when not configured', async () => {
    const { delistListingFromKickio, KickioSyncNotConfiguredError } = await loadModule({
      kickioSupabaseUrl: '',
      kickioSupabaseServiceRoleKey: '',
    });
    await expect(delistListingFromKickio('https://example.com/item')).rejects.toThrow(
      KickioSyncNotConfiguredError,
    );
  });

  it('calls delist_kickio_listing keyed by source_url, not a stored listing id', async () => {
    const { delistListingFromKickio } = await loadModule();
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ action: 'delisted', status: 'sold_elsewhere' }));

    const outcome = await delistListingFromKickio('https://www.vintagefootballshirts.com/products/man-utd-2012-13-away');

    expect(outcome).toEqual({ success: true, action: 'delisted', status: 'sold_elsewhere' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('/rest/v1/rpc/delist_kickio_listing');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.p.source_url).toBe('https://www.vintagefootballshirts.com/products/man-utd-2012-13-away');
  });
});

describe('syncListingAndPersistOutcome', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('../src/config.js');
    vi.doUnmock('../src/db.js');
  });

  async function loadWithDb(configOverrides: Partial<typeof CONFIGURED> = CONFIGURED) {
    vi.resetModules();
    vi.doMock('../src/config.js', () => ({ config: configOverrides }));
    const query = vi.fn(async () => ({ rows: [] }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    const mod = await import('../src/lib/kickioListingSync.js');
    return { ...mod, query };
  }

  it('sets kickio_listing_synced_at and the listing id, clearing any prior error, on success', async () => {
    const { syncListingAndPersistOutcome, query } = await loadWithDb();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      jsonResponse({ action: 'insert', listing_id: 'listing-123', status: 'pending' }),
    );
    const teams = [{ name: 'Manchester United', slug: 'manchester-united', country: 'England' }];

    const outcome = await syncListingAndPersistOutcome('url-1', activeProfile(teams));

    expect(outcome.success).toBe(true);
    const update = query.mock.calls.find(([sql]) => String(sql).includes('kickio_listing_synced_at = now()'));
    expect(update).toBeDefined();
    expect(update![1]).toEqual(['url-1', 'listing-123']);
  });

  it('bumps attempts and records the reason on a deliberate hold, without touching kickio_listing_synced_at', async () => {
    const { syncListingAndPersistOutcome, query } = await loadWithDb();
    const fetchSpy = vi.spyOn(global, 'fetch');

    const outcome = await syncListingAndPersistOutcome('url-1', activeProfile());

    expect(outcome.success).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    const update = query.mock.calls.find(([sql]) =>
      String(sql).includes('kickio_listing_sync_attempts = kickio_listing_sync_attempts + 1'),
    );
    expect(update).toBeDefined();
    expect(update![1][0]).toBe('url-1');
    expect(String(update![1][1])).toMatch(/no confident kickio team match/i);
  });

  it('bumps attempts and records the message when the submit call itself throws', async () => {
    const { syncListingAndPersistOutcome, query } = await loadWithDb();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response('service unavailable', { status: 503, statusText: 'Service Unavailable' }),
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const teams = [{ name: 'Manchester United', slug: 'manchester-united', country: 'England' }];

    const outcome = await syncListingAndPersistOutcome('url-1', activeProfile(teams));

    expect(outcome.success).toBe(false);
    expect(outcome.error).toMatch(/import_kickio_listing failed: 503/);
    const update = query.mock.calls.find(([sql]) =>
      String(sql).includes('kickio_listing_sync_attempts = kickio_listing_sync_attempts + 1'),
    );
    expect(update![1][1]).toMatch(/import_kickio_listing failed: 503/);
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('delistAndPersistOutcome', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('../src/config.js');
    vi.doUnmock('../src/db.js');
  });

  async function loadWithDb(configOverrides: Partial<typeof CONFIGURED> = CONFIGURED) {
    vi.resetModules();
    vi.doMock('../src/config.js', () => ({ config: configOverrides }));
    const query = vi.fn(async () => ({ rows: [] }));
    vi.doMock('../src/db.js', () => ({ pool: { query } }));
    const mod = await import('../src/lib/kickioListingSync.js');
    return { ...mod, query };
  }

  it('sets kickio_delisted_at and clears any prior error on success', async () => {
    const { delistAndPersistOutcome, query } = await loadWithDb();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(jsonResponse({ action: 'delisted', status: 'sold_elsewhere' }));

    const outcome = await delistAndPersistOutcome('url-1', 'https://example.com/item');

    expect(outcome.success).toBe(true);
    const update = query.mock.calls.find(([sql]) => String(sql).includes('kickio_delisted_at = now()'));
    expect(update).toBeDefined();
    expect(update![1]).toEqual(['url-1']);
  });

  it('records the error (reusing kickio_listing_sync_error) rather than throwing, when the delist call fails', async () => {
    const { delistAndPersistOutcome, query } = await loadWithDb();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response('service unavailable', { status: 503, statusText: 'Service Unavailable' }),
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const outcome = await delistAndPersistOutcome('url-1', 'https://example.com/item');

    expect(outcome.success).toBe(false);
    expect(outcome.error).toMatch(/delist_kickio_listing failed: 503/);
    const update = query.mock.calls.find(([sql]) => String(sql).includes('kickio_listing_sync_error = $2'));
    expect(update).toBeDefined();
    expect(update![1][0]).toBe('url-1');
    expect(errorSpy).toHaveBeenCalled();
  });
});
