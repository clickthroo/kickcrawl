import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { PriceChange, Site } from '../lib/types';
import { Button, Card, ErrorBanner, KickioProfilePanel, PageHeader, Select, Spinner, Thumbnail } from '../components/ui';

function formatPrice(value: number, currency: string | null): string {
  return `${currency ?? ''} ${value}`.trim();
}

export default function PriceChanges() {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [priceChanges, setPriceChanges] = useState<PriceChange[] | null>(null);
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
      .get<{ success: boolean; priceChanges: PriceChange[]; total: number }>(`/admin/price-changes?${params.toString()}`)
      .then((res) => {
        setPriceChanges(res.priceChanges);
        setTotal(res.total);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load price changes'));
  }, [siteId, page]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Price Changes"
        subtitle="Items whose price moved by more than £0.50 or 1% (whichever is larger) on a scheduled recheck"
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
        <div className="text-sm text-slate-400">
          {total} price change{total === 1 ? '' : 's'}
        </div>
      </Card>

      {error && <ErrorBanner message={error} />}

      {!priceChanges && !error && <Spinner />}

      {priceChanges?.length === 0 && (
        <Card>
          <p className="text-center text-sm text-slate-400">
            No price changes detected yet - this fills in as rechecks (every 4 hours) catch an item's price moving
            by more than the noise threshold.
          </p>
        </Card>
      )}

      {priceChanges && priceChanges.length > 0 && (
        <div className="space-y-3">
          {priceChanges.map((pc) => {
            const delta = pc.new_price - pc.old_price;
            const isDrop = delta < 0;
            const percent = pc.old_price !== 0 ? (Math.abs(delta) / pc.old_price) * 100 : 0;
            return (
              <Card key={pc.id} className="space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <Thumbnail src={pc.profile?.listing.images[0] ?? null} alt={pc.title ?? pc.url} size={44} />
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-800" title={pc.title ?? undefined}>
                        {pc.title ?? pc.url}
                      </div>
                      <a
                        href={pc.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate text-xs text-slate-400 hover:text-brand-600 hover:underline"
                        title={pc.url}
                      >
                        {pc.url}
                      </a>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                          {pc.site_name}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-xs text-slate-400 sm:text-right">
                    <div className="flex items-center justify-end gap-1.5 text-sm font-medium">
                      <span className="text-slate-400 line-through">{formatPrice(pc.old_price, pc.currency)}</span>
                      <span className={isDrop ? 'text-emerald-600' : 'text-rose-600'}>
                        {formatPrice(pc.new_price, pc.currency)}
                      </span>
                    </div>
                    <div className={isDrop ? 'text-emerald-600' : 'text-rose-600'}>
                      {isDrop ? '↓' : '↑'} {percent.toFixed(1)}%
                    </div>
                    <div>{new Date(pc.detected_at).toLocaleString()}</div>
                  </div>
                </div>

                {/* Same full-profile snapshot the Sales page shows - a price
                    change is just as browsable-by-eye as an active item. */}
                <KickioProfilePanel profile={pc.profile} />
              </Card>
            );
          })}
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
