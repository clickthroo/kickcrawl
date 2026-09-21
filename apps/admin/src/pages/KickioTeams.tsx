import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { Button, Card, ErrorBanner, Input, PageHeader, Spinner } from '../components/ui';

interface KickioTeam {
  name: string;
  slug: string;
  country: string | null;
}

interface KickioTeamsResponse {
  success: boolean;
  teams: KickioTeam[];
  fetchedAt: number;
  stale: boolean;
}

// A 501 here means KICKIO_SUPABASE_URL/KICKIO_SUPABASE_ANON_KEY aren't
// configured in this deployment, not a real failure - shown as a plain
// explanation rather than the generic error banner.
const NOT_CONFIGURED_STATUS = 501;

export default function KickioTeams() {
  const [teams, setTeams] = useState<KickioTeam[] | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [stale, setStale] = useState(false);
  const [notConfigured, setNotConfigured] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');

  function load(refresh = false) {
    setError(null);
    setNotConfigured(false);
    api
      .get<KickioTeamsResponse>(`/admin/kickio-teams${refresh ? '?refresh=1' : ''}`)
      .then((res) => {
        setTeams(res.teams);
        setFetchedAt(res.fetchedAt);
        setStale(res.stale);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === NOT_CONFIGURED_STATUS) {
          setNotConfigured(true);
          setTeams([]);
          return;
        }
        setError(err instanceof ApiError ? err.message : 'Failed to load Kickio teams');
      })
      .finally(() => setRefreshing(false));
  }

  useEffect(() => load(), []);

  async function refresh() {
    setRefreshing(true);
    load(true);
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!teams) return [];
    if (!q) return teams;
    return teams.filter(
      (t) => t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q) || (t.country ?? '').toLowerCase().includes(q),
    );
  }, [teams, query]);

  if (teams === null) return error ? <ErrorBanner message={error} /> : <Spinner />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Kickio Teams"
        subtitle="Kickio's live canonical team list, to check a scraped listing's guessed Team field against."
        actions={
          !notConfigured && (
            <Button variant="secondary" onClick={refresh} disabled={refreshing}>
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </Button>
          )
        }
      />

      {error && <ErrorBanner message={error} />}

      {notConfigured && (
        <Card>
          <p className="text-sm text-slate-600">
            This deployment hasn't been connected to Kickio's team list yet - set{' '}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">KICKIO_SUPABASE_URL</code> and{' '}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">KICKIO_SUPABASE_ANON_KEY</code> (see{' '}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">.env.example</code>) to enable this page.
          </p>
        </Card>
      )}

      {!notConfigured && (
        <>
          {stale && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              Couldn't reach Kickio just now - showing the last successfully loaded list instead.
            </div>
          )}

          <Card>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="w-full sm:max-w-sm">
                <Input
                  label="Search"
                  placeholder="Team name, slug, or country"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="text-xs text-slate-500">
                {filtered.length.toLocaleString()} of {teams.length.toLocaleString()} teams
                {fetchedAt && <> · loaded {new Date(fetchedAt).toLocaleString()}</>}
              </div>
            </div>
          </Card>

          <Card className="p-0">
            {filtered.length === 0 ? (
              <p className="p-5 text-sm text-slate-500">No teams match "{query}".</p>
            ) : (
              <div className="max-h-[70vh] overflow-y-auto">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">Name</th>
                      <th className="px-4 py-2.5">Slug</th>
                      <th className="px-4 py-2.5">Country</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filtered.map((t) => (
                      <tr key={t.slug} className="hover:bg-slate-50">
                        <td className="px-4 py-2 font-medium text-slate-800">{t.name}</td>
                        <td className="px-4 py-2 text-slate-500">{t.slug}</td>
                        <td className="px-4 py-2 text-slate-500">{t.country ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
