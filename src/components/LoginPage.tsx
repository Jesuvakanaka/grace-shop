'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { STOREFRONT_PREFIX } from '@/lib/host-routing';
import { SITE_ROUTES, sitePath } from '@/lib/storefront/paths';

export function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSetup, setIsSetup] = useState(false);
  const [fullName, setFullName] = useState('');
  // Whether first-time setup is allowed on this server.
  const [setupAllowed, setSetupAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/setup')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`status ${res.status}`))))
      .then((data: { setupAllowed?: boolean }) => {
        if (cancelled) return;
        setSetupAllowed(data.setupAllowed !== false);
      })
      .catch(() => {
        // Unknown: keep the old behaviour (link shown; the server still guards setup).
        if (!cancelled) setSetupAllowed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, fullName }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Setup failed');
      }
      await login(username, password);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-cream px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="sr-only">VYRA – Wear Different</h1>
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand SVG lockup, no optimisation needed */}
          <img
            src="/brand/vyra-lockup.svg"
            alt=""
            width={236}
            height={204}
            className="mx-auto w-48 sm:w-56 h-auto"
          />
          <p className="mt-5 text-xs font-medium uppercase tracking-[0.22em] text-slate-600">Stock, Cash &amp; Credit</p>
        </div>

        <div className="card">
          <h2 className="text-3xl text-slate-900 mb-6">
            {isSetup ? 'First Time Setup' : 'Sign In'}
          </h2>

          <form onSubmit={isSetup ? handleSetup : handleLogin} className="space-y-4">
            {isSetup && (
              <div>
                <label className="label">Full Name</label>
                <input
                  type="text"
                  className="input"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Enter your full name"
                  required
                />
              </div>
            )}

            <div>
              <label className="label">Username</label>
              <input
                type="text"
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter username"
                required
                autoFocus
                data-testid="login-username"
              />
            </div>

            <div>
              <label className="label">Password</label>
              <input
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                required
                data-testid="login-password"
              />
            </div>

            {error && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary w-full"
              data-testid="login-submit"
            >
              {loading ? (isSetup ? 'Setting up...' : 'Signing in...') : isSetup ? 'Create Account & Sign In' : 'Sign In'}
            </button>
          </form>

          {/* Hidden when the server disables first-time setup (production without ALLOW_SETUP=true). */}
          {(setupAllowed || isSetup) && (
            <div className="mt-4 pt-4 border-t border-slate-200">
              <button
                type="button"
                onClick={() => {
                  setIsSetup(!isSetup);
                  setError('');
                }}
                className="text-sm text-slate-500 hover:text-brand-olive-700 transition-colors"
              >
                {isSetup ? '← Back to Sign In' : 'First time? Set up admin account →'}
              </button>
            </div>
          )}
        </div>

        {/* The admin host serves the storefront under /site. */}
        <p className="mt-6 text-center">
          <a
            href={sitePath(STOREFRONT_PREFIX, SITE_ROUTES.home)}
            className="text-sm font-medium text-slate-600 underline underline-offset-4 hover:text-brand-olive-700 transition-colors"
            data-testid="login-site-link"
          >
            Visit the VYRA website →
          </a>
        </p>
      </div>
    </div>
  );
}
