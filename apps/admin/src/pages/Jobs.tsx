import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { Job } from '../lib/types';
import { Badge, Card, ProgressBar, Spinner } from '../components/ui';

export default function Jobs() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  useEffect(() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (typeFilter) params.set('type', typeFilter);
    api.get<{ success: boolean; jobs: Job[] }>(`/admin/jobs?${params.toString()}`).then((res) =>
      setJobs(res.jobs),
    );
  }, [statusFilter, typeFilter]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-800">Jobs</h1>

      <div className="flex gap-3">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">All types</option>
          <option value="scrape">Scrape</option>
          <option value="map">Map</option>
          <option value="crawl">Crawl</option>
          <option value="extract">Extract</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          <option value="queued">Queued</option>
          <option value="running">Running</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <Card className="p-0">
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
            {!jobs && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  <Spinner />
                </td>
              </tr>
            )}
            {jobs?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  No jobs yet.
                </td>
              </tr>
            )}
            {jobs?.map((job) => (
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
                <td className="px-4 py-3 text-slate-500">
                  {new Date(job.created_at).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
