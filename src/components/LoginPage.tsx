'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';

interface QuickLoginUser {
  role: 'OWNER' | 'STAFF';
  username: string;
  fullName: string;
}

const ROLE_LABELS: Record<QuickLoginUser['role'], string> = { OWNER: 'Owner', STAFF: 'Staff' };

export function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSetup, setIsSetup] = useState(false);
  const [fullName, setFullName] = useState('');
  // UAT quick sign-in buttons (GRACE_QUICK_LOGIN) and whether first-time setup is allowed.
  const [quickUsers, setQuickUsers] = useState<QuickLoginUser[]>([]);
  const [setupAllowed, setSetupAllowed] = useState<boolean | null>(null);
  const [quickRole, setQuickRole] = useState<QuickLoginUser['role'] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/quick-login')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`status ${res.status}`))))
      .then((data: { enabled?: boolean; setupAllowed?: boolean; users?: QuickLoginUser[] }) => {
        if (cancelled) return;
        setQuickUsers(data.enabled && Array.isArray(data.users) ? data.users : []);
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

  const busy = loading || quickRole !== null;

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

  const handleQuickLogin = async (role: QuickLoginUser['role']) => {
    setError('');
    setQuickRole(role);
    try {
      const res = await fetch('/api/auth/quick-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Quick sign-in failed');
      }
      // The session cookie is now set. Reload so AuthProvider reads the session and
      // renders the app for the current path, as it does after a normal sign-in.
      window.location.reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Quick sign-in failed');
      setQuickRole(null);
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-slate-50 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-100 border border-emerald-200 rounded-2xl mb-4">
            <span className="text-3xl">📊</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Grace Shop</h1>
          <p className="text-slate-500 mt-1">Stock, Cash & Credit Management</p>
        </div>

        <div className="card">
          {!isSetup && quickUsers.length > 0 && (
            <div className="mb-6 pb-6 border-b border-slate-200" data-testid="quick-login">
              <h2 className="text-lg font-semibold text-slate-900 mb-3">UAT quick sign-in</h2>
              <div className="space-y-2">
                {quickUsers.map((u) => (
                  <button
                    key={u.role}
                    type="button"
                    onClick={() => handleQuickLogin(u.role)}
                    disabled={busy}
                    className="btn btn-secondary w-full"
                    data-testid={`quick-login-${u.role.toLowerCase()}`}
                  >
                    <span className="truncate">
                      {quickRole === u.role ? 'Signing in...' : `${u.fullName} — ${ROLE_LABELS[u.role]}`}
                    </span>
                  </button>
                ))}
              </div>
              <p className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-xs">
                UAT only – quick sign-in is switched on for testing.
              </p>
            </div>
          )}

          <h2 className="text-lg font-semibold text-slate-900 mb-6">
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
              disabled={busy}
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
                className="text-sm text-slate-500 hover:text-emerald-600 transition-colors"
              >
                {isSetup ? '← Back to Sign In' : 'First time? Set up admin account →'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
