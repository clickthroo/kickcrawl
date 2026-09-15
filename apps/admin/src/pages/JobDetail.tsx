import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { Job } from '../lib/types';
import { Badge, Button, Card, ErrorBanner, ProgressBar, Spinner } from '../components/ui';

interface PageLog {
  url: string;
  last_status_code: number | null;
  last_error: string | null;
  format: string;
  fetched_at: string;
}

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<Job | null>(null);
  const [pages, setPages] = useState<PageLog[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rerunning, setRerunning] = useState(false);

  function load() {
    if (!id) return;
    api
      .get<{ success: boolean; job: Job; pages: PageLog[] }>(`/admin/jobs/${id}`)
      .then((res) => {
        setJob(res.job);
        setPages(res.pages);
      });
  }

  useEffect(load, [id]);

  useEffect(() => {
    if (job && (job.status === 'queued' || job.status === 'running')) {
      const t = setInterval(load, 3000);
      return () => clearInterval(t);
    }
  }, [job?.status]);

  async function rerun() {
    if (!id) return;
    setRerunning(true);
    setError(null);
    try {
      await api.post(`/admin/jobs/${id}/rerun`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Re-run failed');
    } finally {
      setRerunning(false);
    }
  }

  if (!job) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">
            {job.site_name ?? 'Untitled'} — <span className="capitalize">{job.type}</span> job
          </h1>
          <div className="mt-1 flex items-center gap-2">
            <Badge status={job.status} />
            <span className="text-xs text-slate-400">{job.id}</span>
          </div>
        </div>
        {job.type === 'crawl' && (
          <Button onClick={rerun} disabled={rerunning}>
            {rerunning ? 'Queuing…' : 'Re-run'}
          </Button>
        )}
      </div>

      {error && <ErrorBanner message={error} />}

      <Card>
        <ProgressBar completed={job.completed_pages} total={job.total_pages} />
        <div className="mt-2 text-sm text-slate-500">
          {job.completed_pages} of {job.total_pages} pages · {job.error_count} errors
        </div>
      </Card>

      {job.errors?.length > 0 && (
        <Card>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Errors</h2>
          <ul className="space-y-1 text-sm text-red-600">
            {job.errors.map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-0">
        <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
          Page log
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-400">
              <th className="px-4 py-2">URL</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Fetched at</th>
            </tr>
          </thead>
          <tbody>
            {pages.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-slate-400">
                  No pages fetched yet.
                </td>
              </tr>
            )}
            {pages.map((p, i) => (
              <tr key={i} className="border-b border-slate-100 last:border-0">
                <td className="max-w-md truncate px-4 py-2 text-slate-700" title={p.url}>
                  {p.url}
                </td>
                <td className="px-4 py-2 text-slate-600">
                  {p.last_error ? (
                    <span className="text-red-600">{p.last_status_code ?? 'error'}</span>
                  ) : (
                    p.last_status_code
                  )}
                </td>
                <td className="px-4 py-2 text-slate-500">
                  {new Date(p.fetched_at).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
