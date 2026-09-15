import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Card, Spinner } from '../components/ui';

interface DashboardStats {
  today: { total: string; success: string; failed: string };
  week: { total: string; success: string; failed: string };
  topSites: { name: string; pages: string }[];
  queueDepth: number;
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <Card>
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-800">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-400">{sub}</div>}
    </Card>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);

  useEffect(() => {
    api.get<{ success: boolean } & DashboardStats>('/admin/stats/dashboard').then(setStats);
  }, []);

  if (!stats) return <Spinner />;

  const successRate =
    Number(stats.today.total) > 0
      ? Math.round((Number(stats.today.success) / Number(stats.today.total)) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-800">Dashboard</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Pages fetched today" value={stats.today.total} />
        <StatCard label="Pages fetched this week" value={stats.week.total} />
        <StatCard label="Success rate (today)" value={`${successRate}%`} sub={`${stats.today.failed} failed`} />
        <StatCard label="Queue depth" value={stats.queueDepth} sub="crawl jobs waiting/active" />
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Top sites by volume (7 days)</h2>
        {stats.topSites.length === 0 ? (
          <p className="text-sm text-slate-500">No pages fetched yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400">
                <th className="py-1">Site</th>
                <th className="py-1 text-right">Pages</th>
              </tr>
            </thead>
            <tbody>
              {stats.topSites.map((s) => (
                <tr key={s.name} className="border-t border-slate-100">
                  <td className="py-2 text-slate-700">{s.name}</td>
                  <td className="py-2 text-right text-slate-700">{s.pages}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
