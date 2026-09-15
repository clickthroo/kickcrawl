import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { Site } from '../lib/types';
import { Button, Card, Spinner } from '../components/ui';

export default function Sites() {
  const [sites, setSites] = useState<Site[] | null>(null);

  function reload() {
    api.get<{ success: boolean; sites: Site[] }>('/admin/sites').then((res) => setSites(res.sites));
  }

  useEffect(reload, []);

  if (!sites) return <Spinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-800">Sites</h1>
        <Link to="/sites/new">
          <Button>Add site</Button>
        </Link>
      </div>

      <Card className="p-0">
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
            {sites.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                  No sites yet. Add your first one to get started.
                </td>
              </tr>
            )}
            {sites.map((site) => (
              <tr key={site.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link to={`/sites/${site.id}`} className="font-medium text-brand-700 hover:underline">
                    {site.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-600">{site.base_url}</td>
                <td className="px-4 py-3 text-slate-600">{site.rate_limit_rps} rps</td>
                <td className="px-4 py-3 text-slate-600">{site.url_count ?? 0}</td>
                <td className="px-4 py-3 text-slate-600">{site.fetched_count ?? 0}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      site.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {site.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
