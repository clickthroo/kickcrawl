import { useEffect, useState, type ReactNode, type SVGProps } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';

type IconProps = SVGProps<SVGSVGElement>;

function IconBase({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

function IconDashboard(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="4.5" rx="1.5" />
      <rect x="13.5" y="10.5" width="7" height="10" rx="1.5" />
      <rect x="3.5" y="13" width="7" height="7.5" rx="1.5" />
    </IconBase>
  );
}

function IconSites(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.4 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.4-3.6-8.5S9.6 5.9 12 3.5Z" />
    </IconBase>
  );
}

function IconItems(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3.5" y="4" width="17" height="4.5" rx="1.2" />
      <rect x="3.5" y="10.25" width="17" height="4.5" rx="1.2" />
      <rect x="3.5" y="16.5" width="17" height="4.5" rx="1.2" />
    </IconBase>
  );
}

function IconSales(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 15.5 9.5 10l4 4 6.5-6.5" />
      <path d="M15 7.5h5v5" />
    </IconBase>
  );
}

function IconJobs(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="4" y="3.5" width="16" height="17" rx="2" />
      <path d="M8.5 3.5V6h7V3.5M8 11h8M8 14.5h8M8 18h5" />
    </IconBase>
  );
}

function IconKey(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="8" cy="15.5" r="4" />
      <path d="M11 12.5 19 4.5M16.5 7 19 4.5M19 4.5l2 2M14 10l2 2" />
    </IconBase>
  );
}

function IconSettings(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2M12 18.3v2.2M4.9 6.5l1.9 1.1M17.2 16.4l1.9 1.1M3.5 12h2.2M18.3 12h2.2M4.9 17.5l1.9-1.1M17.2 7.6l1.9-1.1" />
    </IconBase>
  );
}

function IconLogout(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3M16 16l4-4-4-4M20 12H9" />
    </IconBase>
  );
}

function LogoMark() {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
      <IconBase className="h-5 w-5" strokeWidth={2}>
        <circle cx="12" cy="6" r="2" />
        <circle cx="6" cy="16" r="2" />
        <circle cx="18" cy="16" r="2" />
        <path d="M10.5 7.5 7.5 14.5M13.5 7.5l3 7M8 16h8" />
      </IconBase>
    </div>
  );
}

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', tabLabel: 'Home', icon: IconDashboard, end: true },
  { to: '/sites', label: 'Sites', tabLabel: 'Sites', icon: IconSites, end: false },
  { to: '/items', label: 'Items', tabLabel: 'Items', icon: IconItems, end: false },
  { to: '/sales', label: 'Sales', tabLabel: 'Sales', icon: IconSales, end: false },
  { to: '/jobs', label: 'Jobs', tabLabel: 'Jobs', icon: IconJobs, end: false },
  { to: '/api-keys', label: 'API Keys', tabLabel: 'Keys', icon: IconKey, end: false },
  { to: '/settings', label: 'Settings', tabLabel: 'Settings', icon: IconSettings, end: false },
];

export default function Layout() {
  const { email, logout } = useAuth();
  const [accountOpen, setAccountOpen] = useState(false);
  const location = useLocation();

  useEffect(() => setAccountOpen(false), [location.pathname]);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <LogoMark />
          <span className="text-lg font-semibold text-slate-800">Kickcrawl</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon
                    className={`h-5 w-5 shrink-0 transition-colors ${
                      isActive ? 'text-brand-600' : 'text-slate-400 group-hover:text-slate-500'
                    }`}
                  />
                  {item.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-200 p-4">
          <div className="truncate text-xs text-slate-500" title={email ?? undefined}>
            {email}
          </div>
          <button
            onClick={() => logout()}
            className="mt-2 flex items-center gap-1.5 rounded-md text-sm font-medium text-slate-600 transition-colors hover:text-brand-700"
          >
            <IconLogout className="h-4 w-4" />
            Log out
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:hidden">
        <div className="flex items-center gap-2">
          <LogoMark />
          <span className="text-base font-semibold text-slate-800">Kickcrawl</span>
        </div>
        <button
          onClick={() => setAccountOpen((v) => !v)}
          aria-label="Account menu"
          aria-expanded={accountOpen}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700 transition-colors active:bg-brand-100"
        >
          {(email?.[0] ?? '?').toUpperCase()}
        </button>
      </header>

      {accountOpen && (
        <>
          <button
            aria-label="Close account menu"
            className="fixed inset-0 z-30 md:hidden"
            onClick={() => setAccountOpen(false)}
          />
          <div className="fixed right-4 top-[3.75rem] z-40 w-60 rounded-xl border border-slate-200 bg-white p-3 shadow-lg md:hidden">
            <div className="truncate px-1 pb-2 text-xs text-slate-500" title={email ?? undefined}>
              {email}
            </div>
            <button
              onClick={() => logout()}
              className="flex w-full items-center gap-2 rounded-md px-2 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 active:bg-slate-100"
            >
              <IconLogout className="h-4 w-4" />
              Log out
            </button>
          </div>
        </>
      )}

      {/* Main content */}
      <main className="px-4 py-4 pb-24 sm:px-6 sm:py-6 md:ml-60 md:px-8 md:py-8 md:pb-8">
        <Outlet />
      </main>

      {/* Mobile bottom tab bar */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200 bg-white/95 backdrop-blur md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors ${
                isActive ? 'text-brand-600' : 'text-slate-400'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <item.icon className="h-5 w-5" strokeWidth={isActive ? 2 : 1.75} />
                {item.tabLabel}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
