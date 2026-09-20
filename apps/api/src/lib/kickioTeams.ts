import { config } from '../config.js';

export interface KickioTeam {
  name: string;
  slug: string;
  country: string | null;
}

export class KickioTeamsNotConfiguredError extends Error {
  constructor() {
    super('KICKIO_SUPABASE_URL / KICKIO_SUPABASE_ANON_KEY are not configured');
  }
}

// Kickio's PostgREST endpoint caps a single request's rows (defaults to
// 1000) regardless of what's asked for, so the full ~3000-team table needs
// paging through via `offset` until a short page proves there's no more.
const PAGE_SIZE = 1000;
const CACHE_TTL_MS = 10 * 60 * 1000;

let cache: { teams: KickioTeam[]; fetchedAt: number } | null = null;

async function fetchPage(offset: number): Promise<KickioTeam[]> {
  const url = new URL('/rest/v1/teams', config.kickioSupabaseUrl);
  url.searchParams.set('select', 'name,slug,country');
  url.searchParams.set('deleted_at', 'is.null');
  url.searchParams.set('order', 'name.asc');
  url.searchParams.set('limit', String(PAGE_SIZE));
  url.searchParams.set('offset', String(offset));

  const res = await fetch(url, {
    headers: {
      apikey: config.kickioSupabaseAnonKey,
      Authorization: `Bearer ${config.kickioSupabaseAnonKey}`,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Kickio teams fetch failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as KickioTeam[];
}

async function fetchAllTeams(): Promise<KickioTeam[]> {
  const teams: KickioTeam[] = [];
  let offset = 0;
  for (;;) {
    const page = await fetchPage(offset);
    teams.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return teams;
}

/**
 * Kickio's live canonical team list, for the admin UI to eyeball scraped
 * team guesses against - not used anywhere in the scrape/mapping pipeline
 * itself (that stays best-effort text per kickioProfile.ts; matching a
 * guess to a canonical team is Kickio's own job, at import time, via its
 * `match_team_smart`/`team_aliases`).
 */
export async function getKickioTeams(
  force = false,
): Promise<{ teams: KickioTeam[]; fetchedAt: number; stale: boolean }> {
  if (!config.kickioSupabaseUrl || !config.kickioSupabaseAnonKey) {
    throw new KickioTeamsNotConfiguredError();
  }
  if (!force && cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return { teams: cache.teams, fetchedAt: cache.fetchedAt, stale: false };
  }
  try {
    const teams = await fetchAllTeams();
    cache = { teams, fetchedAt: Date.now() };
    return { teams, fetchedAt: cache.fetchedAt, stale: false };
  } catch (err) {
    // A transient failure (network blip, Kickio momentarily down) shouldn't
    // blank out a page that was working a minute ago - serve the stale
    // cache instead, flagged, and only throw when there's nothing to fall
    // back to.
    if (cache) return { teams: cache.teams, fetchedAt: cache.fetchedAt, stale: true };
    throw err;
  }
}

/** Test-only - clears the module-level cache between test cases. */
export function resetKickioTeamsCacheForTests(): void {
  cache = null;
}
