import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { Site, UrlRecord } from '../lib/types';
import { Badge, Button, Card, ErrorBanner, Input, Spinner, Thumbnail } from '../components/ui';

export default function SiteDetail() {
  const { id } = useParams<{ id: string }>();
  const [site, setSite] = useState<Site | null>(null);
  const [urls, setUrls] = useState<UrlRecord[] | null>(null);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [pathFilter, setPathFilter] = useState('');
  const [page, setPage] = useState(1);
  const [mapping, setMapping] = useState(false);
  const [rescraping, setRescraping] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 25;

  useEffect(() => {
    if (!id) return;
    api.get<{ success: boolean; site: Site }>(`/admin/sites/${id}`).then((res) => setSite(res.site));
  }, [id]);

  function loadUrls() {
    if (!id) return;
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (status) params.set('status', status);
    if (pathFilter) params.set('path', pathFilter);
    api
      .get<{ success: boolean; urls: UrlRecord[]; total: number }>(
        `/admin/sites/${id}/urls?${params.toString()}`,
      )
      .then((res) => {
        setUrls(res.urls);
        setTotal(res.total);
      });
  }

  useEffect(loadUrls, [id, status, pathFilter, page]);

  async function runMap() {
    if (!site) return;
    setMapping(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.post<{ success: boolean; total: number }>(
        `/admin/sites/${site.id}/map`,
      );
      setMessage(`Map discovered ${res.total} URLs.`);
      setPage(1);
      loadUrls();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Map run failed');
    } finally {
      setMapping(false);
    }
  }

  async function rescrape(urlId: string) {
    setRescraping(urlId);
    setError(null);
    try {
      await api.post(`/admin/urls/${urlId}/rescrape`);
      loadUrls();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Re-scrape failed');
    } finally {
      setRescraping(null);
    }
  }

  if (!site) return <Spinner />;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">{site.name}</h1>
          <p className="text-sm text-slate-500">{site.base_url}</p>
        </div>
        <div className="flex gap-2">
          <Link to={`/sites/${site.id}/edit`}>
            <Button variant="secondary">Edit site</Button>
          </Link>
          <Button onClick={runMap} disabled={mapping}>
            {mapping ? 'Mapping…' : 'Run map'}
          </Button>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}
      {message && (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {message}
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-40">
            <label className="mb-1 block text-sm font-medium text-slate-700">Status</label>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">All</option>
              <option value="discovered">Discovered</option>
              <option value="queued">Queued</option>
              <option value="fetched">Fetched</option>
              <option value="failed">Failed</option>
            </select>
          </div>
          <div className="w-64">
            <Input
              label="Path contains"
              value={pathFilter}
              onChange={(e) => {
                setPathFilter(e.target.value);
                setPage(1);
              }}
              placeholder="/shirt/"
            />
          </div>
          <div className="text-sm text-slate-400">{total} URLs</div>
        </div>
      </Card>

      <Card className="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-400">
              <th className="px-4 py-3">URL</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Last fetched</th>
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {!urls && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            )}
            {urls && urls.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                  No URLs found. Run a map to discover pages on this site.
                </td>
              </tr>
            )}
            {urls?.map((u) => (
              <tr key={u.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="max-w-md px-4 py-3 text-slate-700">
                  <div className="flex items-center gap-3">
                    <Thumbnail src={u.preview_image} alt={u.preview_title ?? u.path} size={36} />
                    <div className="min-w-0">
                      <div className="truncate font-medium" title={u.preview_title ?? undefined}>
                        {u.preview_title ?? u.path}
                      </div>
                      <div className="truncate text-xs text-slate-400" title={u.url}>
                        {u.path}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-1.5">
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
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {u.last_fetched_at ? new Date(u.last_fetched_at).toLocaleString() : '—'}
                </td>
                <td className="px-4 py-3 text-slate-500">{u.last_status_code ?? '—'}</td>
                <td className="px-4 py-3 text-right">
                  <Button
                    variant="secondary"
                    onClick={() => rescrape(u.id)}
                    disabled={rescraping === u.id}
                  >
                    {rescraping === u.id ? 'Scraping…' : 'Re-scrape'}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

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
