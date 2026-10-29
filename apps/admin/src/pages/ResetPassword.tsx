import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { Button, ErrorBanner, Input } from '../components/ui';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/admin/auth/reset-password', { token, password });
      navigate('/login');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="mb-1 text-base font-semibold text-slate-800">Reset password</h1>
        {!token ? (
          <>
            <div className="mb-4 mt-3">
              <ErrorBanner message="This link is missing its reset token. Request a new one below." />
            </div>
            <Link to="/forgot-password" className="text-sm text-brand-600 hover:underline">
              Request a new reset link
            </Link>
          </>
        ) : (
          <form onSubmit={onSubmit}>
            <p className="mb-4 text-sm text-slate-500">Choose a new password (at least 8 characters).</p>
            {error && (
              <div className="mb-3">
                <ErrorBanner message={error} />
                {/* An expired/already-used link is the most likely cause - point
                    straight at the fix rather than leaving the admin stuck. */}
                {error.toLowerCase().includes('invalid or has expired') && (
                  <Link to="/forgot-password" className="mt-2 inline-block text-sm text-brand-600 hover:underline">
                    Request a new reset link
                  </Link>
                )}
              </div>
            )}
            <div className="mb-3">
              <Input
                label="New password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>
            <div className="mb-4">
              <Input
                label="Confirm new password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? 'Resetting…' : 'Reset password'}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
