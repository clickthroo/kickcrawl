import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { Sale, Site } from '../lib/types';
import { Button, Card, ErrorBanner, KickioProfilePanel, PageHeader, Select, Spinner, Thumbnail } from '../components/ui';

export default function Sales() {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [sales, setSales] = useState<Sale[] | null>(null);
  const [total, setTotal] = useState(0);
  const [siteId, setSiteId] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 25;

  useEffect(() => {
    api
      .get<{ success: boolean; sites: Site[] }>('/admin/sites')
      .then((res) => setSites(res.sites))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load sites'));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (siteId) params.set('site_id', siteId);
    api
      .get<{ success: boolean; sales: Sale[]; total: number }>(`/admin/sales?${params.toString()}`)
      .then((res) => {
        setSales(res.sales);
        setTotal(res.total);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load sales'));
  }, [siteId, page]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sales"
        subtitle="Items detected as sold - flipped from In Stock to Out of Stock on a scheduled recheck"
      />

      <Card className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
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
        <div className="text-sm text-slate-400">{total} sale{total === 1 ? '' : 's'}</div>
      </Card>

      {error && <ErrorBanner message={error} />}

      {!sales && !error && <Spinner />}

      {sales?.length === 0 && (
        <Card>
          <p className="text-center text-sm text-slate-400">
            No sales detected yet - this fills in as rechecks (every 4 hours) catch an item going from In Stock
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
