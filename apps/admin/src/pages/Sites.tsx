import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { Site } from '../lib/types';
import { Button, Card, ErrorBanner, PageHeader, Spinner } from '../components/ui';

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
      }`}
    >
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

export default function Sites() {
  const navigate = useNavigate();
  const [sites, setSites] = useState<Site[] | null>(null);
  const [crawlingAll, setCrawlingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    api.get<{ success: boolean; sites: Site[] }>('/admin/sites').then((res) => setSites(res.sites));
  }

  useEffect(reload, []);

  async function crawlAll() {
    setCrawlingAll(true);
    setError(null);
    try {
      await api.post<{ success: boolean; jobIds: string[]; total: number }>('/admin/sites/crawl-all');
      navigate('/jobs?type=crawl');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to start crawls');
    } finally {
      setCrawlingAll(false);
    }
  }

  if (!sites) return <Spinner />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Sites"
        actions={
          <>
            <Button
              variant="secondary"
              onClick={crawlAll}
              disabled={crawlingAll || sites.every((s) => !s.is_active)}
              className="flex-1 sm:flex-initial"
              title="Discover and fetch content for every active site"
            >
              {crawlingAll ? 'Starting…' : 'Crawl all sites'}
            </Button>
            <Link to="/sites/new" className="flex-1 sm:flex-initial">
              <Button className="w-full">Add site</Button>
            </Link>
          </>
        }
      />

      {error && <ErrorBanner message={error} />}

      {sites.length === 0 && (
        <Card>
          <p className="text-center text-sm text-slate-400">No sites yet. Add your first one to get started.</p>
        </Card>
      )}

      {sites.length > 0 && (
        <>
          {/* Mobile: card list */}
          <div className="space-y-3 md:hidden">
            {sites.map((site) => (
              <Link key={site.id} to={`/sites/${site.id}`}>
                <Card className="space-y-2 transition-shadow active:shadow-none">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-800">{site.name}</div>
                      <div className="truncate text-xs text-slate-500">{site.base_url}</div>
                    </div>
                    <StatusBadge active={site.is_active} />
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                    <span>{site.rate_limit_rps} rps</span>
                    <span>{site.url_count ?? 0} URLs</span>
                    <span>{site.fetched_count ?? 0} fetched</span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>

          {/* Desktop: table */}
          <Card className="hidden p-0 md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-slate-400">
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Base URL</th>
                    <th className="px-4 py-3">Rate limit</th>
                    <th className="px-4 py-3">URLs</th>
                    <th className="px-4 py-3">Fetched</th>
                    <th className="px-4 py-3">Active</th>
                  </tr>
                </thead>
                <tbody>
                  {sites.map((site) => (
                    <tr key={site.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <Link to={`/sites/${site.id}`} className="font-medium text-brand-700 hover:underline">
                          {site.name}
                        </Link>
                      </td>
                      <td className="max-w-xs truncate px-4 py-3 text-slate-600">{site.base_url}</td>
                      <td className="px-4 py-3 text-slate-600">{site.rate_limit_rps} rps</td>
                      <td className="px-4 py-3 text-slate-600">{site.url_count ?? 0}</td>
                      <td className="px-4 py-3 text-slate-600">{site.fetched_count ?? 0}</td>
                      <td className="px-4 py-3">
                        <StatusBadge active={site.is_active} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
