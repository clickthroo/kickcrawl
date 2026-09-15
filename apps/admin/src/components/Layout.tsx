import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard' },
  { to: '/sites', label: 'Sites' },
  { to: '/jobs', label: 'Jobs' },
  { to: '/api-keys', label: 'API Keys' },
  { to: '/settings', label: 'Settings' },
];

export default function Layout() {
  const { email, logout } = useAuth();

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-slate-200 bg-white">
        <div className="px-5 py-5 text-lg font-semibold text-brand-700">Kickcrawl</div>
        <nav className="flex flex-col gap-1 px-3">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `rounded-md px-3 py-2 text-sm font-medium ${
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="absolute bottom-0 w-56 border-t border-slate-200 p-4">
          <div className="truncate text-xs text-slate-500">{email}</div>
          <button
            onClick={() => logout()}
            className="mt-2 text-sm font-medium text-slate-600 hover:text-brand-700"
          >
            Log out
          </button>
        </div>
      </aside>
      <main className="flex-1 bg-slate-50 p-8">
        <Outlet />
      </main>
    </div>
  );
}
