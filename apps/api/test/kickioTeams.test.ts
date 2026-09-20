import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CONFIGURED = { kickioSupabaseUrl: 'https://example.supabase.co', kickioSupabaseAnonKey: 'test-anon-key' };

async function loadModule(configOverrides: Partial<typeof CONFIGURED> = CONFIGURED) {
  vi.resetModules();
  vi.doMock('../src/config.js', () => ({ config: configOverrides }));
  return import('../src/lib/kickioTeams.js');
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('getKickioTeams', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('../src/config.js');
  });

  it('throws KickioTeamsNotConfiguredError when the Kickio Supabase env vars are blank', async () => {
    const { getKickioTeams, KickioTeamsNotConfiguredError } = await loadModule({
      kickioSupabaseUrl: '',
      kickioSupabaseAnonKey: '',
    });
    await expect(getKickioTeams()).rejects.toThrow(KickioTeamsNotConfiguredError);
  });

  it('pages through Kickio\'s PostgREST endpoint until a short page proves there is no more', async () => {
    const { getKickioTeams } = await loadModule();
    // A full first page (exactly PAGE_SIZE) is this endpoint's own signal
    // that there might be more - anything shorter means it's the last one.
    const firstPage = Array.from({ length: 1000 }, (_, i) => ({
      name: `Team ${i}`,
      slug: `team-${i}`,
      country: 'England',
    }));
    const secondPage = [{ name: 'Team 1000', slug: 'team-1000', country: 'Scotland' }];
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse(firstPage))
      .mockResolvedValueOnce(jsonResponse(secondPage));

    const { teams, stale } = await getKickioTeams();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(teams).toHaveLength(1001);
    expect(teams[1000]).toEqual({ name: 'Team 1000', slug: 'team-1000', country: 'Scotland' });
    expect(stale).toBe(false);

    const [firstUrl, firstInit] = fetchSpy.mock.calls[0];
    expect(String(firstUrl)).toContain('offset=0');
    expect((firstInit as RequestInit).headers).toMatchObject({ apikey: 'test-anon-key' });
    const [secondUrl] = fetchSpy.mock.calls[1];
    expect(String(secondUrl)).toContain('offset=1000');
  });

  it('serves the cached list on a second call within the TTL, without fetching again', async () => {
    const { getKickioTeams } = await loadModule();
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse([{ name: 'Arsenal', slug: 'arsenal', country: 'England' }]));

    await getKickioTeams();
    await getKickioTeams();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('bypasses the cache when force-refreshed', async () => {
    const { getKickioTeams } = await loadModule();
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse([{ name: 'Arsenal', slug: 'arsenal', country: 'England' }]));

    await getKickioTeams();
    await getKickioTeams(true);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('falls back to the stale cache instead of failing when a later refresh errors', async () => {
    const { getKickioTeams } = await loadModule();
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(jsonResponse([{ name: 'Arsenal', slug: 'arsenal', country: 'England' }]))
      .mockRejectedValueOnce(new Error('network blip'));

    await getKickioTeams();
    const second = await getKickioTeams(true);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(second.stale).toBe(true);
    expect(second.teams).toEqual([{ name: 'Arsenal', slug: 'arsenal', country: 'England' }]);
  });

  it('throws when a refresh fails and there is no cache to fall back to', async () => {
    const { getKickioTeams } = await loadModule();
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network blip'));

    await expect(getKickioTeams()).rejects.toThrow('network blip');
  });
});
