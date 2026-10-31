'use client';

import React, { useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { MIN_PASSWORD_LENGTH, validatePasswordChange } from '@/lib/password-policy';

export default function ChangePasswordPage() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }
    const check = validatePasswordChange({ username: user?.username || '', currentPassword, newPassword });
    if (!check.ok) {
      setError(check.error);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to change password');
      setMessage('Password changed. Use the new password next time you sign in.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-md mx-auto">
      <h1 className="text-xl lg:text-2xl font-bold text-slate-900">Change Password</h1>
      <p className="text-sm text-slate-500">
        Signed in as <span className="font-medium text-slate-700">{user?.username}</span>. The new password must be at
        least {MIN_PASSWORD_LENGTH} characters and must not be your username.
      </p>

      <form onSubmit={handleSubmit} className="card space-y-4" data-testid="change-password-form">
        <div>
          <label className="label">Current password</label>
          <input
            type="password"
            className="input"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            required
            data-testid="current-password"
          />
        </div>
        <div>
          <label className="label">New password</label>
          <input
            type="password"
            className="input"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
            data-testid="new-password"
          />
        </div>
        <div>
          <label className="label">Confirm new password</label>
          <input
            type="password"
            className="input"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
            data-testid="confirm-password"
          />
        </div>

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-sm" data-testid="change-password-error">
            {error}
          </div>
        )}
        {message && (
          <div className="p-3 bg-brand-olive-50 border border-brand-olive-200 rounded-lg text-brand-olive-700 text-sm" data-testid="change-password-success">
            {message}
          </div>
        )}

        <button type="submit" disabled={saving} className="btn btn-primary w-full" data-testid="change-password-submit">
          {saving ? 'Saving...' : 'Change Password'}
        </button>
      </form>
    </div>
  );
}
