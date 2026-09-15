import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { Job, JobPageItem } from '../lib/types';
import { Badge, Button, Card, ErrorBanner, ProgressBar, Spinner, Thumbnail } from '../components/ui';

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<Job | null>(null);
  const [pages, setPages] = useState<JobPageItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rerunning, setRerunning] = useState(false);

  function load() {
    if (!id) return;
    api
      .get<{ success: boolean; job: Job; pages: JobPageItem[] }>(`/admin/jobs/${id}`)
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

      <div>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Scraped items</h2>
        {pages.length === 0 ? (
          <Card>
            <p className="text-center text-sm text-slate-400">No pages fetched yet.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {pages.map((p, i) => (
              <Card key={i} className="space-y-2">
                <div className="flex items-start gap-3">
                  <Thumbnail src={p.image} alt={p.title ?? p.url} size={56} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-800" title={p.title ?? p.url}>
                      {p.title ?? p.url}
                    </div>
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate text-xs text-slate-400 hover:text-brand-600"
                      title={p.url}
                    >
                      {p.url}
                    </a>
                  </div>
                </div>

                {p.extracted && Object.keys(p.extracted).length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(p.extracted)
                      // Skip a field that's just the same photo already shown as
                      // the thumbnail above (e.g. a "photo" selector), and any
                      // value long enough to be a data URI rather than a label.
                      .filter(([, value]) => value !== p.image && value.length <= 200)
                      .map(([field, value]) => (
                        <span
                          key={field}
                          className="max-w-full rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
                        >
                          <span className="font-medium text-slate-500">{field}:</span>{' '}
                          <span className="break-all">{value}</span>
                        </span>
                      ))}
                  </div>
                )}

                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className={p.last_error ? 'text-red-600' : ''}>
                    {p.last_error ? `Error (${p.last_status_code ?? '?'})` : `Status ${p.last_status_code}`}
                  </span>
                  <span>{new Date(p.fetched_at).toLocaleString()}</span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
