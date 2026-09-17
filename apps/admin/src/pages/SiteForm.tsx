import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { Site } from '../lib/types';
import { Button, Card, ErrorBanner, Input, PageHeader } from '../components/ui';

const EMPTY: Omit<Site, 'id' | 'created_at' | 'updated_at'> = {
  name: '',
  base_url: '',
  rate_limit_rps: 1,
  max_depth: 2,
  use_browser_default: false,
  use_proxy: false,
  default_selectors: {},
  allowed_paths: [],
  denied_paths: [],
  is_active: true,
  require_pro_seller: false,
  min_seller_feedback: null,
};

export default function SiteForm() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const [form, setForm] = useState(EMPTY);
  const [selectorsJson, setSelectorsJson] = useState('{}');
  const [allowedPathsText, setAllowedPathsText] = useState('');
  const [deniedPathsText, setDeniedPathsText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!id) return;
    api.get<{ success: boolean; site: Site }>(`/admin/sites/${id}`).then((res) => {
      setForm(res.site);
      setSelectorsJson(JSON.stringify(res.site.default_selectors, null, 2));
      setAllowedPathsText(res.site.allowed_paths.join('\n'));
      setDeniedPathsText(res.site.denied_paths.join('\n'));
    });
  }, [id]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    let selectors: Record<string, string>;
    try {
      selectors = JSON.parse(selectorsJson || '{}');
    } catch {
      setError('Default selectors must be valid JSON, e.g. {"price": ".price"}');
      return;
    }

    const payload = {
      ...form,
      default_selectors: selectors,
      allowed_paths: allowedPathsText.split('\n').map((s) => s.trim()).filter(Boolean),
      denied_paths: deniedPathsText.split('\n').map((s) => s.trim()).filter(Boolean),
    };

    setSubmitting(true);
    try {
      if (isEdit) {
        await api.put(`/admin/sites/${id}`, payload);
      } else {
        await api.post('/admin/sites', payload);
      }
      navigate('/sites');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save site');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title={isEdit ? 'Edit site' : 'Add site'} />

      {error && <ErrorBanner message={error} />}

      <form onSubmit={onSubmit} className="space-y-4">
        <Card className="space-y-4">
          <Input
            label="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <Input
            label="Base URL"
            type="url"
            placeholder="https://www.classicfootballshirts.co.uk"
            value={form.base_url}
            onChange={(e) => setForm({ ...form, base_url: e.target.value })}
            required
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Rate limit (requests/sec)"
              type="number"
              step="0.1"
              min="0.1"
              value={form.rate_limit_rps}
              onChange={(e) => setForm({ ...form, rate_limit_rps: Number(e.target.value) })}
            />
            <Input
              label="Max crawl depth"
              type="number"
              min="0"
              value={form.max_depth}
              onChange={(e) => setForm({ ...form, max_depth: Number(e.target.value) })}
            />
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-6">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={form.use_browser_default}
                onChange={(e) => setForm({ ...form, use_browser_default: e.target.checked })}
              />
              Use browser (Playwright) by default
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={form.use_proxy}
                onChange={(e) => setForm({ ...form, use_proxy: e.target.checked })}
              />
              Use proxy
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              />
              Active
            </label>
          </div>
        </Card>

        <Card className="space-y-4">
          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Default selectors (JSON)
            </span>
            <textarea
              value={selectorsJson}
              onChange={(e) => setSelectorsJson(e.target.value)}
              rows={5}
              className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              placeholder={'{\n  "price": ".price",\n  "title": "h1"\n}'}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Allowed paths (one per line)
              </span>
              <textarea
                value={allowedPathsText}
                onChange={(e) => setAllowedPathsText(e.target.value)}
                rows={4}
                className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                placeholder="/shirt/*"
              />
            </div>
            <div>
              <span className="mb-1 block text-sm font-medium text-slate-700">
                Denied paths (one per line)
              </span>
              <textarea
                value={deniedPathsText}
                onChange={(e) => setDeniedPathsText(e.target.value)}
                rows={4}
                className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                placeholder="/cart&#10;/account"
              />
            </div>
          </div>
        </Card>

        <Card className="space-y-4">
          <div>
            <h2 className="text-sm font-medium text-slate-700">Seller filters</h2>
            <p className="mt-1 text-xs text-slate-400">
              For marketplaces where the listing's own seller matters (e.g. Vinted's "Pro" seller badge).
              Checked once an item is fetched - an item that doesn't pass is skipped rather than kept. Leave both
              off for sites with no such concept.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={form.require_pro_seller}
              onChange={(e) => setForm({ ...form, require_pro_seller: e.target.checked })}
            />
            Only keep items from Pro sellers
          </label>
          <div className="sm:w-56">
            <Input
              label="Minimum seller feedback count"
              type="number"
              min="0"
              value={form.min_seller_feedback ?? ''}
              onChange={(e) =>
                setForm({ ...form, min_seller_feedback: e.target.value ? Number(e.target.value) : null })
              }
              placeholder="e.g. 100"
            />
          </div>
        </Card>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
            {submitting ? 'Saving…' : 'Save site'}
          </Button>
          <Button variant="secondary" onClick={() => navigate('/sites')} className="w-full sm:w-auto">
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
