import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { Job } from '../lib/types';
import { Badge, Card, ErrorBanner, PageHeader, ProgressBar, Select, Spinner } from '../components/ui';

export default function Jobs() {
  const [searchParams] = useSearchParams();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState(() => searchParams.get('type') ?? '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (typeFilter) params.set('type', typeFilter);

    function load(): void {
      setError(null);
      api
        .get<{ success: boolean; jobs: Job[] }>(`/admin/jobs?${params.toString()}`)
        .then((res) => setJobs(res.jobs))
        .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load jobs'));
    }

    load();
    // Same polling JobDetail.tsx already does for a single job - without
    // it, this list only ever reflects whatever was true the moment it was
    // loaded, showing a crawl as "Queued" indefinitely even while it's
    // actively running, since nothing here ever re-fetches on its own.
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [statusFilter, typeFilter]);

  return (
    <div className="space-y-4">
      <PageHeader title="Jobs" />

      <div className="grid grid-cols-2 gap-3 sm:flex sm:gap-3">
        <div className="sm:w-44">
          <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All types</option>
            <option value="scrape">Scrape</option>
            <option value="map">Map</option>
            <option value="crawl">Crawl</option>
            <option value="extract">Extract</option>
            <option value="recheck">Recheck</option>
          </Select>
        </div>
        <div className="sm:w-44">
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="queued">Queued</option>
            <option value="running">Running</option>
            <option value="paused">Paused</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {!jobs && !error && <Spinner />}

      {jobs?.length === 0 && (
        <Card>
          <p className="text-center text-sm text-slate-400">No jobs yet.</p>
        </Card>
      )}

      {jobs && jobs.length > 0 && (
        <>
          {/* Mobile: card list */}
          <div className="space-y-3 md:hidden">
            {jobs.map((job) => (
              <Link key={job.id} to={`/jobs/${job.id}`}>
                <Card className="space-y-2 transition-shadow active:shadow-none">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-800">{job.site_name ?? '—'}</div>
                      <div className="text-xs capitalize text-slate-500">{job.type} job</div>
                    </div>
                    <Badge status={job.status} />
                  </div>
                  <div>
                    <ProgressBar completed={job.completed_pages} total={job.total_pages} />
                    <div className="mt-1 flex justify-between text-xs text-slate-400">
                      <span>
                        {job.completed_pages}/{job.total_pages} pages
                      </span>
                      <span>{job.error_count} errors</span>
                    </div>
                  </div>
                  <div className="text-xs text-slate-400">{new Date(job.created_at).toLocaleString()}</div>
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
                    <th className="px-4 py-3">Site</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Progress</th>
                    <th className="px-4 py-3">Errors</th>
                    <th className="px-4 py-3">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr key={job.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <Link to={`/jobs/${job.id}`} className="font-medium text-brand-700 hover:underline">
                          {job.site_name ?? '—'}
                        </Link>
                      </td>
                      <td className="px-4 py-3 capitalize text-slate-600">{job.type}</td>
                      <td className="px-4 py-3">
                        <Badge status={job.status} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="w-32">
                          <ProgressBar completed={job.completed_pages} total={job.total_pages} />
                          <div className="mt-1 text-xs text-slate-400">
                            {job.completed_pages}/{job.total_pages}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{job.error_count}</td>
                      <td className="px-4 py-3 text-slate-500">{new Date(job.created_at).toLocaleString()}</td>
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
