import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildKickioProfile } from '../src/services/kickioProfile.js';
import type { SaleForSync } from '../src/lib/kickioSync.js';

const CONFIGURED = {
  kickioSupabaseUrl: 'https://example.supabase.co',
  kickioSupabaseServiceRoleKey: 'test-service-role-key',
};

async function loadModule(configOverrides: Partial<typeof CONFIGURED> = CONFIGURED) {
  vi.resetModules();
  vi.doMock('../src/config.js', () => ({ config: configOverrides }));
  return import('../src/lib/kickioSync.js');
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

// A real listing shape, matched against a live Kickio team so
// team_kickio_match is populated - the one field this whole integration
// is built around never sending without.
function saleWithProfile(overrides: Partial<SaleForSync> = {}): SaleForSync {
  const profile = buildKickioProfile({
    url: 'https://www.vintagefootballshirts.com/products/man-utd-2012-13-away',
    title: '2012-13 Manchester United Nike Away Shirt *BNIB* M',
    images: ['https://www.vintagefootballshirts.com/img/shirt.jpg'],
    kickioTeams: [{ name: 'Manchester United', slug: 'manchester-united', country: 'England' }],
  });
  return {
    id: 'sale-1',
    url_id: 'url-1',
    price: 90,
    currency: 'GBP',
    detected_at: '2026-09-24T12:00:00.000Z',
    profile,
    ...overrides,
  };
}

describe('isKickioSyncConfigured', () => {
  afterEach(() => {
    vi.doUnmock('../src/config.js');
  });

  it('is false when the service role key is blank, even with the url set', async () => {
    const { isKickioSyncConfigured } = await loadModule({
      kickioSupabaseUrl: 'https://example.supabase.co',
      kickioSupabaseServiceRoleKey: '',
    });
    expect(isKickioSyncConfigured()).toBe(false);
  });

  it('is true when both are set', async () => {
    const { isKickioSyncConfigured } = await loadModule();
    expect(isKickioSyncConfigured()).toBe(true);
  });
});

describe('syncSaleToKickio', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('../src/config.js');
  });

  it('throws KickioSyncNotConfiguredError instead of calling out when not configured', async () => {
    const { syncSaleToKickio, KickioSyncNotConfiguredError } = await loadModule({
      kickioSupabaseUrl: '',
      kickioSupabaseServiceRoleKey: '',
    });
    await expect(syncSaleToKickio(saleWithProfile())).rejects.toThrow(KickioSyncNotConfiguredError);
  });

  it('holds - never calls Kickio at all - when there is no confident team match, per the decided write policy', async () => {
    const { syncSaleToKickio } = await loadModule();
    const fetchSpy = vi.spyOn(global, 'fetch');

    // No kickioTeams passed in, so team_kickio_match is never populated -
    // the exact "an unverified guess" case the policy exists for.
    const profile = buildKickioProfile({
      url: 'https://www.vintagefootballshirts.com/products/x',
      title: '2012-13 Manchester United Nike Away Shirt *BNIB* M',
    });
    const outcome = await syncSaleToKickio(saleWithProfile({ profile }));

    expect(outcome.success).toBe(false);
    expect(outcome.error).toMatch(/no confident kickio team match/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('holds when there is no price recorded for the sale', async () => {
    const { syncSaleToKickio } = await loadModule();
    const fetchSpy = vi.spyOn(global, 'fetch');

    const outcome = await syncSaleToKickio(saleWithProfile({ price: null }));

    expect(outcome.success).toBe(false);
    expect(outcome.error).toMatch(/no price/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('holds when the sale has no stored profile snapshot at all', async () => {
    const { syncSaleToKickio } = await loadModule();
    const fetchSpy = vi.spyOn(global, 'fetch');

    const outcome = await syncSaleToKickio(saleWithProfile({ profile: null }));

    expect(outcome.success).toBe(false);
    expect(outcome.error).toMatch(/no stored profile/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('calls import_kickio_product then import_kickio_sale, with the verified team and the same id linking both calls', async () => {
    const { syncSaleToKickio } = await loadModule();
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ product_id: 'product-123', matched_by: 'new', action: 'insert' }))
      .mockResolvedValueOnce(jsonResponse({ action: 'insert', product_id: 'product-123', sale_id: 'kickio-sale-456' }));

    const outcome = await syncSaleToKickio(saleWithProfile());

    expect(outcome).toEqual({
      success: true,
      productId: 'product-123',
      saleId: 'kickio-sale-456',
      action: 'insert',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const [productUrl, productInit] = fetchSpy.mock.calls[0];
    expect(String(productUrl)).toContain('/rest/v1/rpc/import_kickio_product');
    expect((productInit as RequestInit).headers).toMatchObject({
      apikey: 'test-service-role-key',
      Authorization: 'Bearer test-service-role-key',
    });
    const productBody = JSON.parse((productInit as RequestInit).body as string);
    expect(productBody.p.id).toBe('url-1');
    expect(productBody.p.team).toBe('Manchester United'); // team_kickio_match, not a raw guess
    expect(productBody.p.image_url).toBe('https://www.vintagefootballshirts.com/img/shirt.jpg');

    const [saleUrl, saleInit] = fetchSpy.mock.calls[1];
    expect(String(saleUrl)).toContain('/rest/v1/rpc/import_kickio_sale');
    const saleBody = JSON.parse((saleInit as RequestInit).body as string);
    expect(saleBody.p.kickio_shirt_id).toBe('url-1'); // same id as the product call's own id
    expect(saleBody.p.price_cents).toBe(9000);
    expect(saleBody.p.currency).toBe('GBP');
    expect(saleBody.p.team).toBe('Manchester United');
    expect(saleBody.p.player_name).toBeDefined();
  });

  it('surfaces a Kickio RPC error rather than swallowing it', async () => {
    const { syncSaleToKickio } = await loadModule();
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response('service unavailable', { status: 503, statusText: 'Service Unavailable' }),
    );

    await expect(syncSaleToKickio(saleWithProfile())).rejects.toThrow(/import_kickio_product failed: 503/);
  });
});
