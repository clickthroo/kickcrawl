import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { Site, UrlRecord } from '../lib/types';
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  Input,
  KickioProfilePanel,
  PageHeader,
  Select,
  Spinner,
  Thumbnail,
} from '../components/ui';

const EMPTY_FILTERS = {
  siteId: '',
  status: '',
  path: '',
  stockStatus: '',
  team: '',
  season: '',
  shirtType: '',
  player: '',
  number: '',
  colour: '',
  size: '',
  manufacturer: '',
  condition: '',
};

type Filters = typeof EMPTY_FILTERS;

export default function Items() {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [items, setItems] = useState<UrlRecord[] | null>(null);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [moreOpen, setMoreOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [rescraping, setRescraping] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 25;

  useEffect(() => {
    api
      .get<{ success: boolean; sites: Site[] }>('/admin/sites')
      .then((res) => setSites(res.sites))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load sites'));
  }, []);

  function loadItems() {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (filters.siteId) params.set('site_id', filters.siteId);
    if (filters.status) params.set('status', filters.status);
    if (filters.path) params.set('path', filters.path);
    if (filters.stockStatus) params.set('stock_status', filters.stockStatus);
    if (filters.team) params.set('team', filters.team);
    if (filters.season) params.set('season', filters.season);
    if (filters.shirtType) params.set('shirt_type', filters.shirtType);
    if (filters.player) params.set('player', filters.player);
    if (filters.number) params.set('number', filters.number);
    if (filters.colour) params.set('colour', filters.colour);
    if (filters.size) params.set('size', filters.size);
    if (filters.manufacturer) params.set('manufacturer', filters.manufacturer);
    if (filters.condition) params.set('condition', filters.condition);

    api
      .get<{ success: boolean; items: UrlRecord[]; total: number }>(`/admin/items?${params.toString()}`)
      .then((res) => {
        setItems(res.items);
        setTotal(res.total);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load items'));
  }

  useEffect(loadItems, [filters, page]);

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  }

  async function rescrape(urlId: string) {
    setRescraping(urlId);
    setError(null);
    try {
      await api.post(`/admin/urls/${urlId}/rescrape`);
      loadItems();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Re-scrape failed');
    } finally {
      setRescraping(null);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const moreFilterCount = [
    filters.team,
    filters.season,
    filters.shirtType,
    filters.player,
    filters.number,
    filters.colour,
    filters.size,
    filters.manufacturer,
    filters.condition,
  ].filter(Boolean).length;

  return (
    <div className="space-y-4">
      <PageHeader title="Items" subtitle="Every scraped item across all sites" />

      {error && <ErrorBanner message={error} />}

      <Card className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="sm:w-56">
            <Select
              label="Site"
              value={filters.siteId}
              onChange={(e) => updateFilter('siteId', e.target.value)}
            >
              <option value="">All sites</option>
              {(sites ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="sm:w-40">
            <Select
              label="Status"
              value={filters.status}
              onChange={(e) => updateFilter('status', e.target.value)}
            >
              <option value="">All</option>
              <option value="discovered">Discovered</option>
              <option value="queued">Queued</option>
              <option value="fetched">Fetched</option>
              <option value="failed">Failed</option>
            </Select>
          </div>
          <div className="sm:w-44">
            <Select
              label="Stock status"
              value={filters.stockStatus}
              onChange={(e) => updateFilter('stockStatus', e.target.value)}
            >
              <option value="">Any</option>
              <option value="In Stock">In Stock</option>
              <option value="Out of Stock">Out of Stock</option>
              <option value="Unknown">Unknown</option>
            </Select>
          </div>
          <div className="sm:w-64">
            <Input
              label="Path contains"
              value={filters.path}
              onChange={(e) => updateFilter('path', e.target.value)}
              placeholder="/shirt/"
            />
          </div>
          <div className="text-sm text-slate-400">{total} items</div>
        </div>

        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          className="flex items-center gap-1 text-sm font-medium text-brand-700 hover:text-brand-800"
        >
          {moreOpen ? 'Hide' : 'More filters'}
          {moreFilterCount > 0 && (
            <span className="rounded-full bg-brand-100 px-1.5 py-0.5 text-xs text-brand-700">
              {moreFilterCount}
            </span>
          )}
        </button>

        {moreOpen && (
          <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 sm:grid-cols-3 lg:grid-cols-5">
            <Input label="Team" value={filters.team} onChange={(e) => updateFilter('team', e.target.value)} />
            <Input
              label="Season"
              value={filters.season}
              onChange={(e) => updateFilter('season', e.target.value)}
              placeholder="1998-99"
            />
            <Input
              label="Type"
              value={filters.shirtType}
              onChange={(e) => updateFilter('shirtType', e.target.value)}
              placeholder="Home, Away…"
            />
            <Input
              label="Player"
              value={filters.player}
              onChange={(e) => updateFilter('player', e.target.value)}
            />
            <Input
              label="Number"
              value={filters.number}
              onChange={(e) => updateFilter('number', e.target.value)}
            />
            <Input
              label="Colour"
              value={filters.colour}
              onChange={(e) => updateFilter('colour', e.target.value)}
            />
            <Input label="Size" value={filters.size} onChange={(e) => updateFilter('size', e.target.value)} />
            <Input
              label="Manufacturer"
              value={filters.manufacturer}
              onChange={(e) => updateFilter('manufacturer', e.target.value)}
            />
            <Input
              label="Condition"
              value={filters.condition}
              onChange={(e) => updateFilter('condition', e.target.value)}
            />
            <div className="flex items-end">
              <Button variant="secondary" className="w-full" onClick={() => setFilters(EMPTY_FILTERS)}>
                Clear all
              </Button>
            </div>
          </div>
        )}
      </Card>

      {!items && <Spinner />}

      {items && items.length === 0 && (
        <Card>
          <p className="text-center text-sm text-slate-400">No items match these filters.</p>
        </Card>
      )}

      {items && items.length > 0 && (
        <div className="space-y-3">
          {items.map((u) => (
            <Card key={u.id} className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <Thumbnail src={u.preview_image} alt={u.preview_title ?? u.path} size={44} />
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-800" title={u.preview_title ?? undefined}>
                      {u.preview_title ?? u.path}
                    </div>
                    <a
                      href={u.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate text-xs text-slate-400 hover:text-brand-600 hover:underline"
                      title={u.url}
                    >
                      {u.url}
                    </a>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Link
                        to={`/sites/${u.site_id}`}
                        className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-200"
                      >
                        {u.site_name}
                      </Link>
                      <Badge status={u.status} />
                      {u.preview_profile?.needs_review && (
                        <span
                          className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700"
                          title={u.preview_profile.review_reason ?? undefined}
                        >
                          Needs review
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center justify-between gap-3 text-xs text-slate-400 sm:flex-col sm:items-end sm:text-right">
                  <div>
                    {u.last_fetched_at ? (
                      <div>Last crawled {new Date(u.last_fetched_at).toLocaleString()}</div>
                    ) : (
                      // Discovered but never actually fetched yet (still
                      // queued, or waiting its turn) - there's no crawl date
                      // to show, but showing nothing at all here reads as
                      // broken rather than "not fetched yet".
                      <div>Discovered {new Date(u.discovered_at).toLocaleString()}</div>
                    )}
                    <div>Code {u.last_status_code ?? '—'}</div>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => rescrape(u.id)}
                    disabled={rescraping === u.id}
                    className="px-3 py-1.5 text-xs sm:mt-1"
                  >
                    {rescraping === u.id ? 'Scraping…' : 'Re-scrape'}
                  </Button>
                </div>
              </div>

              <KickioProfilePanel profile={u.preview_profile} />
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
            <Button
              variant="secondary"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
