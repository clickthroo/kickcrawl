import { FormEvent, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ApiError } from '../lib/api';
import { Button, ErrorBanner, Input } from '../components/ui';

export default function Login() {
  const { email, login } = useAuth();
  const [loginEmail, setLoginEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  if (email) {
    const target = (location.state as { from?: string })?.from ?? '/';
    return <Navigate to={target} replace />;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(loginEmail, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
      >
        <div className="mb-5 flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
              <circle cx="12" cy="6" r="2" />
              <circle cx="6" cy="16" r="2" />
              <circle cx="18" cy="16" r="2" />
              <path d="M10.5 7.5 7.5 14.5M13.5 7.5l3 7M8 16h8" />
            </svg>
          </div>
          <div>
            <h1 className="text-base font-semibold text-slate-800">Kickcrawl Admin</h1>
            <p className="text-xs text-slate-500">Sign in to manage sites and jobs.</p>
          </div>
        </div>
        {error && (
          <div className="mb-3">
            <ErrorBanner message={error} />
          </div>
        )}
        <div className="mb-3">
          <Input
            label="Email"
            type="email"
            value={loginEmail}
            onChange={(e) => setLoginEmail(e.target.value)}
            required
          />
        </div>
        <div className="mb-4">
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}
