import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { ApiKey } from '../lib/types';
import { Button, Card, ErrorBanner, Input, PageHeader, Spinner } from '../components/ui';

export default function ApiKeys() {
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function reload() {
    api
      .get<{ success: boolean; apiKeys: ApiKey[] }>('/admin/api-keys')
      .then((res) => setKeys(res.apiKeys))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load API keys'));
  }

  useEffect(reload, []);

  async function createKey(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const res = await api.post<{ success: boolean; plainKey: string }>('/admin/api-keys', { name });
      setNewKey(res.plainKey);
      setName('');
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create API key');
    } finally {
      setCreating(false);
    }
  }

  async function deleteKey(id: string) {
    if (!confirm('Delete this API key? Any client using it will stop working immediately.')) return;
    setDeletingId(id);
    setError(null);
    try {
      await api.delete(`/admin/api-keys/${id}`);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete API key');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title="API Keys"
        subtitle={
          <>
            Kickio's scrapers authenticate with these keys via{' '}
            <code className="rounded bg-slate-100 px-1 py-0.5">Authorization: Bearer &lt;key&gt;</code>.
          </>
        }
      />

      {error && <ErrorBanner message={error} />}

      {newKey && (
        <Card className="border-brand-200 bg-brand-50">
          <p className="mb-2 text-sm font-medium text-slate-700">
            Copy this key now — it won't be shown again.
          </p>
          <code className="block break-all rounded-md bg-white px-3 py-2 text-sm">{newKey}</code>
          <Button variant="secondary" className="mt-3" onClick={() => setNewKey(null)}>
            Done
          </Button>
        </Card>
      )}

      <Card>
        <form onSubmit={createKey} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Input
              label="New key name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Kickio production scraper"
              required
            />
          </div>
          <Button type="submit" disabled={creating} className="w-full sm:w-auto">
            {creating ? 'Creating…' : 'Generate key'}
          </Button>
        </form>
      </Card>

      {!keys && <Spinner />}

      {keys?.length === 0 && (
        <Card>
          <p className="text-center text-sm text-slate-400">No API keys yet.</p>
        </Card>
      )}

      {keys && keys.length > 0 && (
        <>
          {/* Mobile: card list */}
          <div className="space-y-3 md:hidden">
            {keys.map((k) => (
              <Card key={k.id} className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-800">{k.name}</div>
                    <div className="truncate font-mono text-xs text-slate-500">{k.key_preview}</div>
                  </div>
                  <Button
                    variant="danger"
                    onClick={() => deleteKey(k.id)}
                    disabled={deletingId === k.id}
                    className="shrink-0 px-2.5 py-1.5 text-xs"
                  >
                    {deletingId === k.id ? 'Deleting…' : 'Delete'}
                  </Button>
                </div>
                <div className="text-xs text-slate-400">
                  {k.last_used_at ? `Last used ${new Date(k.last_used_at).toLocaleString()}` : 'Never used'}
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
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Key</th>
                    <th className="px-4 py-3">Last used</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {keys.map((k) => (
                    <tr key={k.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-3 text-slate-700">{k.name}</td>
                      <td className="px-4 py-3 font-mono text-slate-500">{k.key_preview}</td>
                      <td className="px-4 py-3 text-slate-500">
                        {k.last_used_at ? new Date(k.last_used_at).toLocaleString() : 'Never'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button variant="danger" onClick={() => deleteKey(k.id)} disabled={deletingId === k.id}>
                          {deletingId === k.id ? 'Deleting…' : 'Delete'}
                        </Button>
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
