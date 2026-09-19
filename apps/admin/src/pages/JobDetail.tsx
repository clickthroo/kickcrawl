import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { Job, JobPageItem } from '../lib/types';
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  KickioProfilePanel,
  PageHeader,
  ProgressBar,
  Spinner,
  Thumbnail,
} from '../components/ui';

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<Job | null>(null);
  const [pages, setPages] = useState<JobPageItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rerunning, setRerunning] = useState(false);
  const [action, setAction] = useState<'pause' | 'resume' | 'cancel' | null>(null);

  function load() {
    if (!id) return;
    api
      .get<{ success: boolean; job: Job; pages: JobPageItem[] }>(`/admin/jobs/${id}`)
      .then((res) => {
        setJob(res.job);
        setPages(res.pages);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load job'));
  }

  useEffect(load, [id]);

  useEffect(() => {
    if (job && (job.status === 'queued' || job.status === 'running' || job.status === 'paused')) {
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

  async function runAction(kind: 'pause' | 'resume' | 'cancel') {
    if (!id) return;
    setAction(kind);
    setError(null);
    try {
      await api.post(`/admin/jobs/${id}/${kind}`);
      load();
    } catch (err) {
      const fallback = { pause: 'Pause', resume: 'Resume', cancel: 'Cancel' }[kind];
      setError(err instanceof ApiError ? err.message : `${fallback} failed`);
    } finally {
      setAction(null);
    }
  }

  if (!job) return error ? <ErrorBanner message={error} /> : <Spinner />;

  return (
    <div className="space-y-4">
      <PageHeader
        title={
          <>
            {job.site_name ?? 'Untitled'} — <span className="capitalize">{job.type}</span> job
          </>
        }
        subtitle={
          <span className="flex items-center gap-2">
            <Badge status={job.status} />
            <span className="text-xs text-slate-400">{job.id}</span>
          </span>
        }
        actions={
          job.type === 'crawl' && (
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              {job.status === 'running' && (
                <>
                  <Button variant="secondary" onClick={() => runAction('pause')} disabled={action !== null}>
                    {action === 'pause' ? 'Pausing…' : 'Pause'}
                  </Button>
                  <Button variant="danger" onClick={() => runAction('cancel')} disabled={action !== null}>
                    {action === 'cancel' ? 'Cancelling…' : 'Cancel'}
                  </Button>
                </>
              )}
              {job.status === 'paused' && (
                <>
                  <Button onClick={() => runAction('resume')} disabled={action !== null}>
                    {action === 'resume' ? 'Resuming…' : 'Resume'}
                  </Button>
                  <Button variant="danger" onClick={() => runAction('cancel')} disabled={action !== null}>
                    {action === 'cancel' ? 'Cancelling…' : 'Cancel'}
                  </Button>
                </>
              )}
              {job.status === 'queued' && (
                <Button variant="danger" onClick={() => runAction('cancel')} disabled={action !== null}>
                  {action === 'cancel' ? 'Cancelling…' : 'Cancel'}
                </Button>
              )}
              {(job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') && (
                <Button onClick={rerun} disabled={rerunning} className="w-full sm:w-auto">
                  {rerunning ? 'Queuing…' : 'Re-run'}
                </Button>
              )}
            </div>
          )
        }
      />

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

                <KickioProfilePanel profile={p.profile} />

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
