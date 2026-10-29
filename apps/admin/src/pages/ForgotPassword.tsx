import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { Button, ErrorBanner, Input } from '../components/ui';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Shown regardless of whether the email actually matched an admin - the
  // backend responds success either way (routes/admin/auth.ts) so this page
  // can never be used to enumerate which addresses have accounts.
  const [submitted, setSubmitted] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/admin/auth/forgot-password', { email });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="mb-1 text-base font-semibold text-slate-800">Forgot password</h1>
        {submitted ? (
          <>
            <p className="mb-4 text-sm text-slate-600">
              If that email has an account, a reset link has been generated and printed to the server's
              deploy logs - there's no email delivery configured for this admin tool, so check there (or
              ask whoever manages this deployment).
            </p>
            <Link to="/login" className="text-sm text-brand-600 hover:underline">
              Back to sign in
            </Link>
          </>
        ) : (
          <form onSubmit={onSubmit}>
            <p className="mb-4 text-sm text-slate-500">
              Enter the admin email. A reset link will be printed to the server's deploy logs - this tool
              has no email delivery set up.
            </p>
            {error && (
              <div className="mb-3">
                <ErrorBanner message={error} />
              </div>
            )}
            <div className="mb-4">
              <Input
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? 'Sending…' : 'Send reset link'}
            </Button>
            <div className="mt-4 text-center">
              <Link to="/login" className="text-sm text-slate-500 hover:underline">
                Back to sign in
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
