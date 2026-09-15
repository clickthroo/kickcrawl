import { useEffect, useState, type ReactNode, type SVGProps } from 'react';
import { api } from '../lib/api';
import { Card, PageHeader, Spinner } from '../components/ui';

interface DashboardStats {
  today: { total: string; success: string; failed: string };
  week: { total: string; success: string; failed: string };
  topSites: { name: string; pages: string }[];
  queueDepth: number;
}

function StatIconBase(props: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  const { children, ...rest } = props;
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" {...rest}>
      {children}
    </svg>
  );
}

function IconToday(props: SVGProps<SVGSVGElement>) {
  return (
    <StatIconBase {...props}>
      <rect x="3.5" y="4.5" width="17" height="16" rx="2" />
      <path d="M3.5 9.5h17M8 3v3M16 3v3" />
    </StatIconBase>
  );
}
function IconWeek(props: SVGProps<SVGSVGElement>) {
  return (
    <StatIconBase {...props}>
      <path d="M4 19V9.5l8-5 8 5V19a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1Z" />
    </StatIconBase>
  );
}
function IconRate(props: SVGProps<SVGSVGElement>) {
  return (
    <StatIconBase {...props}>
      <path d="m4.5 13 4 4L19.5 6" />
    </StatIconBase>
  );
}
function IconQueue(props: SVGProps<SVGSVGElement>) {
  return (
    <StatIconBase {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </StatIconBase>
  );
}

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = 'brand',
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: (props: SVGProps<SVGSVGElement>) => JSX.Element;
  tone?: 'brand' | 'green' | 'amber';
}) {
  const toneStyles = {
    brand: 'bg-brand-50 text-brand-600',
    green: 'bg-green-50 text-green-600',
    amber: 'bg-amber-50 text-amber-600',
  };
  return (
    <Card className="flex items-start gap-3">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${toneStyles[tone]}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <div className="text-xs text-slate-500 sm:text-sm">{label}</div>
        <div className="mt-0.5 text-xl font-semibold text-slate-800 sm:text-2xl">{value}</div>
        {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
      </div>
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
      <PageHeader title="Dashboard" />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Pages fetched today" value={stats.today.total} icon={IconToday} tone="brand" />
        <StatCard label="Pages fetched this week" value={stats.week.total} icon={IconWeek} tone="brand" />
        <StatCard
          label="Success rate (today)"
          value={`${successRate}%`}
          sub={`${stats.today.failed} failed`}
          icon={IconRate}
          tone="green"
        />
        <StatCard
          label="Queue depth"
          value={stats.queueDepth}
          sub="waiting/active"
          icon={IconQueue}
          tone="amber"
        />
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Top sites by volume (7 days)</h2>
        {stats.topSites.length === 0 ? (
          <p className="text-sm text-slate-500">No pages fetched yet.</p>
        ) : (
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[280px] text-sm">
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
          </div>
        )}
      </Card>
    </div>
  );
}
