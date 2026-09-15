import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { Settings as SettingsType } from '../lib/types';
import { Button, Card, ErrorBanner, Input, Spinner } from '../components/ui';

export default function Settings() {
  const [form, setForm] = useState<SettingsType | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get<{ success: boolean; settings: SettingsType }>('/admin/settings').then((res) =>
      setForm(res.settings),
    );
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.put('/admin/settings', form);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  if (!form) return <Spinner />;

  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-xl font-semibold text-slate-800">Settings</h1>

      {error && <ErrorBanner message={error} />}
      {saved && (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          Settings saved.
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        <Card className="space-y-4">
          <Input
            label="Global rate limit (requests/sec, used when a site has none configured)"
            type="number"
            step="0.1"
            value={form.global_rate_limit_rps}
            onChange={(e) => setForm({ ...form, global_rate_limit_rps: Number(e.target.value) })}
          />
          <Input
            label="Default user agent"
            value={form.default_user_agent}
            onChange={(e) => setForm({ ...form, default_user_agent: e.target.value })}
          />
          <Input
            label="Proxy URL"
            value={form.proxy_url ?? ''}
            onChange={(e) => setForm({ ...form, proxy_url: e.target.value })}
            placeholder="http://user:pass@host:port"
          />
        </Card>

        <Card className="space-y-4">
          <Input
            label="LLM provider"
            value={form.llm_provider}
            onChange={(e) => setForm({ ...form, llm_provider: e.target.value })}
          />
          <Input
            label="LLM model"
            value={form.llm_model}
            onChange={(e) => setForm({ ...form, llm_model: e.target.value })}
          />
        </Card>

        <Card className="space-y-4">
          <Input
            label="Notification email (on job failures)"
            type="email"
            value={form.notification_email ?? ''}
            onChange={(e) => setForm({ ...form, notification_email: e.target.value })}
          />
          <Input
            label="Webhook URL (fired on crawl job completion)"
            value={form.webhook_url ?? ''}
            onChange={(e) => setForm({ ...form, webhook_url: e.target.value })}
          />
        </Card>

        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </Button>
      </form>
    </div>
  );
}
