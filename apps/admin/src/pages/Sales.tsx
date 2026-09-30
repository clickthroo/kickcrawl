import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { KickioSyncCounts, Sale, Site } from '../lib/types';
import { Badge, Button, Card, ErrorBanner, KickioProfilePanel, PageHeader, Select, Spinner, Thumbnail } from '../components/ui';

type KickioStatus = '' | 'synced' | 'held' | 'stuck' | 'dismissed';

const KICKIO_TEAMS_DATALIST_ID = 'kickio-teams-datalist';

// A 501 from /admin/kickio-teams means KICKIO_SUPABASE_URL/ANON_KEY aren't
// configured in this deployment - see KickioTeams.tsx's own NOT_CONFIGURED_STATUS.
// The manual team-select feature just quietly disappears in that case, same
// as the dedicated Kickio Teams page does, rather than showing a broken input.
const KICKIO_NOT_CONFIGURED_STATUS = 501;

/** One "set team" control for a single unsynced sale - kept as its own component so its input/submitting state doesn't leak between cards. */
function SetTeamControl({ saleId, onDone }: { saleId: string; onDone: () => Promise<void> }) {
  const [team, setTeam] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!team.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/admin/sales/${saleId}/set-team`, { team: team.trim() });
      setTeam('');
      await onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to set team');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <input
        type="text"
        list={KICKIO_TEAMS_DATALIST_ID}
        value={team}
        onChange={(e) => setTeam(e.target.value)}
        placeholder="Set team…"
        className="min-h-0 w-40 rounded-md border border-slate-300 px-2 py-1 text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      />
      <Button
        variant="secondary"
        className="!min-h-0 !py-1 text-xs"
        disabled={submitting || !team.trim()}
        onClick={submit}
      >
        {submitting ? 'Setting…' : 'Set team'}
      </Button>
      {error && <span className="text-xs text-rose-600">{error}</span>}
    </div>
  );
}

export default function Sales() {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [sales, setSales] = useState<Sale[] | null>(null);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<KickioSyncCounts | null>(null);
  const [siteId, setSiteId] = useState('');
  const [kickioStatusFilter, setKickioStatusFilter] = useState<KickioStatus>('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [resyncingId, setResyncingId] = useState<string | null>(null);
  const [resyncMessages, setResyncMessages] = useState<Record<string, string>>({});
  const [kickioTeamNames, setKickioTeamNames] = useState<string[]>([]);
  const [retryingAll, setRetryingAll] = useState(false);
  const [debuggingId, setDebuggingId] = useState<string | null>(null);
  const [debugResults, setDebugResults] = useState<Record<string, unknown>>({});
  const [retryAllMessage, setRetryAllMessage] = useState<string | null>(null);
  const pageSize = 25;

  useEffect(() => {
    api
      .get<{ success: boolean; sites: Site[] }>('/admin/sites')
      .then((res) => setSites(res.sites))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load sites'));
  }, []);

  useEffect(() => {
    // Sourced from the same endpoint KickioTeams.tsx uses (10-min server
    // cache, ~3000 teams) - fetched once here, at the page level, and
    // shared by every sale card's <datalist> rather than each card
    // fetching (or rendering thousands of <option> elements) on its own.
    // A 501 (not configured in this deployment) just leaves the list
    // empty - each SetTeamControl still renders, but with no suggestions.
    api
      .get<{ success: boolean; teams: { name: string }[] }>('/admin/kickio-teams')
      .then((res) => setKickioTeamNames(res.teams.map((t) => t.name)))
      .catch((err) => {
        if (err instanceof ApiError && err.status === KICKIO_NOT_CONFIGURED_STATUS) return;
        // Non-fatal - the retry/status UI still works without team names to suggest.
      });
  }, []);

  const loadSales = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (siteId) params.set('site_id', siteId);
    if (kickioStatusFilter) params.set('kickio_status', kickioStatusFilter);
    return api
      .get<{ success: boolean; sales: Sale[]; total: number; kickioCounts: KickioSyncCounts }>(
        `/admin/sales?${params.toString()}`,
      )
      .then((res) => {
        setSales(res.sales);
        setTotal(res.total);
        setCounts(res.kickioCounts);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load sales'));
  }, [siteId, kickioStatusFilter, page]);

  useEffect(() => {
    loadSales();
  }, [loadSales]);

  async function retrySync(saleId: string) {
    setRetryingId(saleId);
    try {
      // The route always answers 200 when the retry itself ran - a held
      // outcome (no team match, Kickio momentarily down, ...) is routine,
      // reflected in the refetched row's own kickio_sync_error below, not
      // a page-level error. Only a genuinely invalid request (sale not
      // found, already synced) throws here.
      await api.post(`/admin/sales/${saleId}/retry-kickio-sync`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Retry failed');
    } finally {
      setRetryingId(null);
      await loadSales();
    }
  }

  async function debugTeamMatch(saleId: string) {
    setDebuggingId(saleId);
    try {
      const res = await api.get<{ success: boolean; debug: unknown }>(
        `/admin/sales/${saleId}/debug-kickio-team-match`,
      );
      setDebugResults((r) => ({ ...r, [saleId]: res.debug }));
    } catch (err) {
      setDebugResults((r) => ({
        ...r,
        [saleId]: { error: err instanceof ApiError ? err.message : 'Debug request failed' },
      }));
    } finally {
      setDebuggingId(null);
    }
  }

  async function dismissSale(saleId: string) {
    setDismissingId(saleId);
    try {
      // Excludes the sale from both the hourly worker and the manual
      // "retry all" recovery sweep going forward - a standing decision,
      // not a one-off skip, so it persists until explicitly undone.
      await api.post(`/admin/sales/${saleId}/dismiss-kickio-sync`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to dismiss');
    } finally {
      setDismissingId(null);
      await loadSales();
    }
  }

  async function undismissSale(saleId: string) {
    setDismissingId(saleId);
    try {
      await api.post(`/admin/sales/${saleId}/undismiss-kickio-sync`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to undismiss');
    } finally {
      setDismissingId(null);
      await loadSales();
    }
  }

  async function forceResync(saleId: string) {
    setResyncingId(saleId);
    setResyncMessages((m) => ({ ...m, [saleId]: '' }));
    try {
      // Re-fetches the original listing page fresh and rebuilds its
      // profile with today's mapping code before resending - the only
      // way to correct an already-synced sale whose team/player/etc was
      // wrong at the time it was sent (a mapping bug, since fixed, but
      // fixing the code never retroactively corrects a snapshot already
      // taken and already sent). Can genuinely fail (502) when the
      // source page is no longer reachable - some retailers remove a
      // one-off listing once it's sold - so both outcomes are shown.
      const res = await api.post<{ success: boolean; outcome?: { success: boolean; error?: string } }>(
        `/admin/sales/${saleId}/force-resync-kickio`,
      );
      setResyncMessages((m) => ({
        ...m,
        [saleId]: res.outcome?.success
          ? 'Resynced with freshly re-scraped data.'
          : `Resync attempted, but the sync itself is still held: ${res.outcome?.error ?? 'unknown reason'}`,
      }));
    } catch (err) {
      setResyncMessages((m) => ({
        ...m,
        [saleId]: err instanceof ApiError ? err.message : 'Force resync failed',
      }));
    } finally {
      setResyncingId(null);
      await loadSales();
    }
  }

  async function retryAllStuck() {
    setRetryingAll(true);
    setRetryAllMessage(null);
    try {
      // Runs as a background job (kickioSyncWorker's recovery sweep), not
      // inline - a real backlog can take longer than an HTTP request
      // should ever block for, so this only queues it. Progress shows up
      // on the Jobs page like any other job; the counts here won't move
      // until it's actually done and this page is reloaded/refetched.
      await api.post('/admin/sales/retry-all-kickio-sync');
      setRetryAllMessage('Queued - check the Jobs page for progress, then refresh this page once it completes.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to queue the retry-all sweep');
    } finally {
      setRetryingAll(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      {/* Shared by every SetTeamControl below - a single list of ~3000
          <option>s rendered once at the page level, not per sale card,
          which would otherwise multiply into a real DOM-performance
          problem on a page of 25 sales. */}
      <datalist id={KICKIO_TEAMS_DATALIST_ID}>
        {kickioTeamNames.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

      <PageHeader
        title="Sales"
        subtitle="Items detected as sold - flipped from In Stock to Out of Stock on a scheduled recheck"
      />

      <Card className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="sm:w-56">
            <Select
              label="Site"
              value={siteId}
              onChange={(e) => {
                setSiteId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All sites</option>
              {(sites ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="sm:w-56">
            <Select
              label="Kickio sync"
              value={kickioStatusFilter}
              onChange={(e) => {
                setKickioStatusFilter(e.target.value as KickioStatus);
                setPage(1);
              }}
            >
              <option value="">All</option>
              <option value="synced">Synced{counts ? ` (${counts.synced})` : ''}</option>
              <option value="held">Held{counts ? ` (${counts.held})` : ''}</option>
              <option value="stuck">Stuck{counts ? ` (${counts.stuck})` : ''}</option>
              <option value="dismissed">Dismissed{counts ? ` (${counts.dismissed})` : ''}</option>
            </Select>
          </div>
        </div>
        <div className="text-sm text-slate-400">{total} sale{total === 1 ? '' : 's'}</div>
      </Card>

      {counts && counts.stuck > 0 && (
        <div className="flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 sm:flex-row sm:items-center sm:justify-between">
          <span>
            {counts.stuck} sale{counts.stuck === 1 ? '' : 's'} exceeded the automatic retry limit and stopped
            syncing to Kickio - filter by "Stuck" below to review individually, or retry all of them at once
            (e.g. after an upstream Kickio-side fix that's since resolved whatever was blocking them).
          </span>
          <Button
            variant="secondary"
            className="!min-h-0 shrink-0 !py-1.5 text-xs"
            disabled={retryingAll}
            onClick={retryAllStuck}
          >
            {retryingAll ? 'Queuing…' : 'Retry all now'}
          </Button>
        </div>
      )}

      {retryAllMessage && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {retryAllMessage}
        </div>
      )}

      {error && <ErrorBanner message={error} />}

      {!sales && !error && <Spinner />}

      {sales?.length === 0 && (
        <Card>
          <p className="text-center text-sm text-slate-400">
            No sales detected yet - this fills in as rechecks (every hour) catch an item going from In Stock
            to Out of Stock.
          </p>
        </Card>
      )}

      {sales && sales.length > 0 && (
        <div className="space-y-3">
          {sales.map((s) => (
            <Card key={s.id} className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <Thumbnail src={s.profile?.listing.images[0] ?? null} alt={s.title ?? s.url} size={44} />
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-800" title={s.title ?? undefined}>
                      {s.title ?? s.url}
                    </div>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate text-xs text-slate-400 hover:text-brand-600 hover:underline"
                      title={s.url}
                    >
                      {s.url}
                    </a>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                        {s.site_name}
                      </span>
                      <Badge status={s.kickio_status} />
                    </div>
                  </div>
                </div>
                <div className="shrink-0 text-right text-xs text-slate-400 sm:text-right">
                  <div className="text-sm font-medium text-slate-800">
                    {s.price != null ? `${s.currency ?? ''} ${s.price}`.trim() : '—'}
                  </div>
                  <div>{new Date(s.detected_at).toLocaleString()}</div>
                </div>
              </div>

              {/* Not shown at all once synced - kickio_sync_error is
                  cleared on success, so a synced sale has nothing to
                  explain here. A dismissed one gets its own quieter panel
                  (below) - Retry/Set team don't apply to something an
                  admin has deliberately opted out of. A held/stuck one
                  shows exactly why Kickio hasn't received it and how many
                  hourly attempts it's had, plus a way to try again right
                  now instead of waiting for (or, once stuck, never
                  getting) the next automatic cycle, and a way to opt it
                  out entirely if it just shouldn't be sent at all. */}
              {!s.kickio_synced_at && !s.kickio_sync_dismissed_at && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <div className="min-w-0">
                    <span className="font-medium text-slate-700">Not synced to Kickio</span>
                    {s.kickio_sync_error && <span className="text-slate-500"> — {s.kickio_sync_error}</span>}
                    <span className="text-slate-400"> ({s.kickio_sync_attempts} attempt{s.kickio_sync_attempts === 1 ? '' : 's'})</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {kickioTeamNames.length > 0 && <SetTeamControl saleId={s.id} onDone={loadSales} />}
                    <Button
                      variant="secondary"
                      className="!min-h-0 !py-1 text-xs"
                      disabled={retryingId === s.id}
                      onClick={() => retrySync(s.id)}
                    >
                      {retryingId === s.id ? 'Retrying…' : 'Retry now'}
                    </Button>
                    <Button
                      variant="secondary"
                      className="!min-h-0 !py-1 text-xs"
                      disabled={debuggingId === s.id}
                      onClick={() => debugTeamMatch(s.id)}
                      title="Re-run the Kickio team match against a fresh live team list and show exactly why - never touches this sale"
                    >
                      {debuggingId === s.id ? 'Debugging…' : 'Debug team match'}
                    </Button>
                    <Button
                      variant="secondary"
                      className="!min-h-0 !py-1 text-xs text-slate-500"
                      disabled={dismissingId === s.id}
                      onClick={() => dismissSale(s.id)}
                    >
                      {dismissingId === s.id ? 'Dismissing…' : 'Dismiss'}
                    </Button>
                  </div>
                </div>
              )}

              {debugResults[s.id] !== undefined && (
                <pre className="overflow-x-auto rounded-md border border-slate-200 bg-slate-900 px-3 py-2 text-[11px] leading-relaxed text-slate-100">
                  {JSON.stringify(debugResults[s.id], null, 2)}
                </pre>
              )}

              {/* Nothing to show for a routine synced sale beyond the
                  Badge above, except when it's been re-checked - Force
                  resync exists specifically for a sale whose data was
                  wrong at the time it synced (a mapping bug since fixed),
                  not for routine sales, so it stays a deliberate, visible
                  action rather than something that runs automatically. */}
              {s.kickio_synced_at && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <div className="min-w-0">
                    <span className="font-medium text-slate-700">Synced to Kickio</span>
                    <span className="text-slate-400"> (since {new Date(s.kickio_synced_at).toLocaleString()})</span>
                    {resyncMessages[s.id] && <div className="mt-0.5 text-slate-500">{resyncMessages[s.id]}</div>}
                  </div>
                  <Button
                    variant="secondary"
                    className="!min-h-0 !py-1 text-xs"
                    disabled={resyncingId === s.id}
                    onClick={() => forceResync(s.id)}
                    title="Re-fetch the source listing and resend corrected data to Kickio"
                  >
                    {resyncingId === s.id ? 'Resyncing…' : 'Force resync'}
                  </Button>
                </div>
              )}

              {s.kickio_sync_dismissed_at && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <div className="min-w-0">
                    <span className="font-medium text-slate-700">Dismissed</span>
                    <span className="text-slate-500"> — excluded from Kickio sync</span>
                    <span className="text-slate-400"> (since {new Date(s.kickio_sync_dismissed_at).toLocaleString()})</span>
                  </div>
                  <Button
                    variant="secondary"
                    className="!min-h-0 !py-1 text-xs"
                    disabled={dismissingId === s.id}
                    onClick={() => undismissSale(s.id)}
                  >
                    {dismissingId === s.id ? 'Undismissing…' : 'Undismiss'}
                  </Button>
                </div>
              )}

              {/* Every feature known about the item at the moment it sold -
                  same panel the Items list uses for an active one, so a sold
                  item is just as browsable/filterable-by-eye as a live one.
                  Older sales recorded before this snapshot existed have no
                  profile to show. */}
              <KickioProfilePanel profile={s.profile} />
            </Card>
          ))}
        </div>
      )}

      {total > pageSize && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
