import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Sale, Site } from '../lib/types';
import { Button, Card, PageHeader, Select, Spinner } from '../components/ui';

export default function Sales() {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [sales, setSales] = useState<Sale[] | null>(null);
  const [total, setTotal] = useState(0);
  const [siteId, setSiteId] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 25;

  useEffect(() => {
    api.get<{ success: boolean; sites: Site[] }>('/admin/sites').then((res) => setSites(res.sites));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (siteId) params.set('site_id', siteId);
    api
      .get<{ success: boolean; sales: Sale[]; total: number }>(`/admin/sales?${params.toString()}`)
      .then((res) => {
        setSales(res.sales);
        setTotal(res.total);
      });
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

      {!sales && <Spinner />}

      {sales?.length === 0 && (
        <Card>
          <p className="text-center text-sm text-slate-400">
            No sales detected yet - this fills in as rechecks (every 4 hours) catch an item going from In Stock
            to Out of Stock.
          </p>
        </Card>
      )}

      {sales && sales.length > 0 && (
        <>
          {/* Mobile: card list */}
          <div className="space-y-3 md:hidden">
            {sales.map((s) => (
              <Card key={s.id} className="space-y-1.5">
                <div className="flex items-start justify-between gap-2">
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
                  </div>
                  <div className="shrink-0 text-right font-medium text-slate-800">
                    {s.price != null ? `${s.currency ?? ''} ${s.price}`.trim() : '—'}
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>{s.site_name}</span>
                  <span>{new Date(s.detected_at).toLocaleString()}</span>
                </div>
              </Card>
            ))}
          </div>

          {/* Desktop: table */}
          <Card className="hidden p-0 md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-400">
                    <th className="px-4 py-3">Item</th>
                    <th className="px-4 py-3">Site</th>
                    <th className="px-4 py-3">Price</th>
                    <th className="px-4 py-3">Detected</th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((s) => (
                    <tr key={s.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                      <td className="max-w-sm px-4 py-3">
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block truncate font-medium text-brand-700 hover:underline"
                          title={s.title ?? s.url}
                        >
                          {s.title ?? s.url}
                        </a>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{s.site_name}</td>
                      <td className="px-4 py-3 text-slate-700">
                        {s.price != null ? `${s.currency ?? ''} ${s.price}`.trim() : '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{new Date(s.detected_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
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
