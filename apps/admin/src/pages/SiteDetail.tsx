import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
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

export default function SiteDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [site, setSite] = useState<Site | null>(null);
  const [urls, setUrls] = useState<UrlRecord[] | null>(null);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [pathFilter, setPathFilter] = useState('');
  const [page, setPage] = useState(1);
  const [mapping, setMapping] = useState(false);
  const [crawling, setCrawling] = useState(false);
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

  async function runCrawl() {
    if (!site) return;
    setCrawling(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api.post<{ success: boolean; jobId: string }>(
        `/admin/sites/${site.id}/crawl`,
      );
      navigate(`/jobs/${res.jobId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Crawl failed to start');
    } finally {
      setCrawling(false);
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
      <PageHeader
        title={site.name}
        subtitle={site.base_url}
        actions={
          <>
            <Link to={`/sites/${site.id}/edit`} className="flex-1 sm:flex-initial">
              <Button variant="secondary" className="w-full">
                Edit site
              </Button>
            </Link>
            <Button
              variant="secondary"
              onClick={runMap}
              disabled={mapping}
              className="flex-1 sm:flex-initial"
              title="Discover URLs on this site without fetching their content"
            >
              {mapping ? 'Mapping…' : 'Run map'}
            </Button>
            <Button
              onClick={runCrawl}
              disabled={crawling}
              className="flex-1 sm:flex-initial"
              title="Discover URLs and fetch each page's content as it's found"
            >
              {crawling ? 'Starting…' : 'Run crawl'}
            </Button>
          </>
        }
      />

      {error && <ErrorBanner message={error} />}
      {message && (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {message}
        </div>
      )}

      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="sm:w-40">
            <Select
              label="Status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All</option>
              <option value="discovered">Discovered</option>
              <option value="queued">Queued</option>
              <option value="fetched">Fetched</option>
              <option value="failed">Failed</option>
            </Select>
          </div>
          <div className="sm:w-64">
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

      {!urls && <Spinner />}

      {urls && urls.length === 0 && (
        <Card>
          <p className="text-center text-sm text-slate-400">
            No URLs found. Run a map to discover pages on this site.
          </p>
        </Card>
      )}

      {urls && urls.length > 0 && (
        <div className="space-y-3">
          {urls.map((u) => (
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
                    <div>{u.last_fetched_at ? new Date(u.last_fetched_at).toLocaleString() : '—'}</div>
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
