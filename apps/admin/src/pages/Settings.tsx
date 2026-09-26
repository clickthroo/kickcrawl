import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { CurrencyRate, Settings as SettingsType } from '../lib/types';
import { Button, Card, ErrorBanner, Input, PageHeader, Spinner } from '../components/ui';

export default function Settings() {
  const [form, setForm] = useState<SettingsType | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [showProxyUrl, setShowProxyUrl] = useState(false);

  useEffect(() => {
    api
      .get<{ success: boolean; settings: SettingsType }>('/admin/settings')
      .then((res) => setForm(res.settings))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load settings'));
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

  if (!form) return error ? <ErrorBanner message={error} /> : <Spinner />;

  return (
    <div className="max-w-xl space-y-4">
      <PageHeader title="Settings" />

      <CurrencyRates />

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
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Proxy URL</span>
            <div className="flex gap-2">
              <input
                type={showProxyUrl ? 'text' : 'password'}
                value={form.proxy_url ?? ''}
                onChange={(e) => setForm({ ...form, proxy_url: e.target.value })}
                placeholder="http://user:pass@host:port"
                // This URL embeds a username/password (the proxy's own
                // basic-auth credentials) - masked by default so it isn't
                // sitting in plain text on screen every time this page
                // loads, the same way any other password field isn't.
                autoComplete="off"
                className="min-h-[2.5rem] w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowProxyUrl((v) => !v)}
                className="shrink-0 px-3 text-xs"
              >
                {showProxyUrl ? 'Hide' : 'Show'}
              </Button>
            </div>
          </label>
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

        <Button type="submit" disabled={saving} className="w-full sm:w-auto">
          {saving ? 'Saving…' : 'Save settings'}
        </Button>
      </form>
    </div>
  );
}

const RATE_STALE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Approximate, admin-maintained GBP conversion rates - not a live FX feed.
 * A non-GBP listing price is converted using whichever of these matches its
 * currency (buildKickioProfile, services/kickioProfile.ts); a currency with
 * no rate here is left in its original currency rather than guessed at.
 */
function CurrencyRates() {
  const [rates, setRates] = useState<CurrencyRate[] | null>(null);
  const [code, setCode] = useState('');
  const [rate, setRate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    api
      .get<{ success: boolean; rates: CurrencyRate[] }>('/admin/currency-rates')
      .then((res) => setRates(res.rates))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load currency rates'));
  }

  useEffect(reload, []);

  async function addRate(e: FormEvent) {
    e.preventDefault();
    const trimmedCode = code.trim().toUpperCase();
    const n = Number(rate);
    if (!trimmedCode || !Number.isFinite(n) || n <= 0) return;
    setSaving(true);
    setError(null);
    try {
      await api.put(`/admin/currency-rates/${trimmedCode}`, { rate_to_gbp: n });
      setCode('');
      setRate('');
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save rate');
    } finally {
      setSaving(false);
    }
  }

  async function updateRate(currencyCode: string, newValue: string) {
    const n = Number(newValue);
    if (!Number.isFinite(n) || n <= 0) return;
    try {
      await api.put(`/admin/currency-rates/${currencyCode}`, { rate_to_gbp: n });
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save rate');
    }
  }

  async function deleteRate(currencyCode: string) {
    if (
      !confirm(
        `Remove the GBP rate for ${currencyCode}? Items priced in ${currencyCode} will show their original, unconverted price until a new rate is added.`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      await api.delete(`/admin/currency-rates/${currencyCode}`);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to remove rate');
    }
  }

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-sm font-medium text-slate-700">Currency conversion rates</h2>
        <p className="mt-1 text-xs text-slate-400">
          A listing priced in a currency other than GBP is converted using the matching rate below and shown as
          the main price, with the original kept alongside for reference. These don't need to be exact — update
          them occasionally rather than relying on a live feed.
        </p>
      </div>

      {error && <ErrorBanner message={error} />}
      {rates === null && <Spinner />}
      {rates?.length === 0 && <p className="text-sm text-slate-400">No conversion rates configured yet.</p>}

      {rates && rates.length > 0 && (
        <div className="space-y-2">
          {rates.map((r) => {
            const stale = Date.now() - new Date(r.updated_at).getTime() > RATE_STALE_MS;
            return (
              <div key={r.code} className="flex flex-wrap items-center gap-2">
                <span className="w-14 shrink-0 font-mono text-sm text-slate-600">{r.code}</span>
                <input
                  type="number"
                  step="0.0001"
                  defaultValue={r.rate_to_gbp}
                  onBlur={(e) => {
                    if (e.target.value !== String(r.rate_to_gbp)) updateRate(r.code, e.target.value);
                  }}
                  className="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
                <span
                  className={`text-xs ${stale ? 'text-amber-600' : 'text-slate-400'}`}
                  title={new Date(r.updated_at).toLocaleString()}
                >
                  {stale ? '⚠ stale, ' : ''}updated {new Date(r.updated_at).toLocaleDateString()}
                </span>
                <button
                  type="button"
                  onClick={() => deleteRate(r.code)}
                  className="ml-auto text-xs text-red-600 hover:underline"
                >
                  Remove
                </button>
              </div>
            );
          })}
        </div>
      )}

      <form onSubmit={addRate} className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
        <div className="w-24">
          <Input
            label="Code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="USD"
            maxLength={10}
          />
        </div>
        <div className="w-32">
          <Input
            label="1 unit = £"
            type="number"
            step="0.0001"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            placeholder="0.79"
          />
        </div>
        <Button type="submit" disabled={saving} className="text-sm">
          {saving ? 'Adding…' : 'Add / update'}
        </Button>
      </form>
    </Card>
  );
}
