'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';

export default function ExchangeRatePage() {
  const { isOwner } = useAuth();
  const [rate, setRate] = useState('');
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    fetchRateData();
  }, []);

  const fetchRateData = async () => {
    try {
      const res = await fetch('/api/exchange-rate');
      const data = await res.json();
      if (res.ok) {
        if (data.activeRate) {
          setRate(data.activeRate.rate.toString());
        }
        setHistory(data.history || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rate || isNaN(Number(rate)) || Number(rate) <= 0) {
      setError('Please enter a valid positive number');
      return;
    }
    setError('');
    setMessage('');
    setSaving(true);
    try {
      const res = await fetch('/api/exchange-rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rate: Number(rate) })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save exchange rate');
      setMessage('Exchange rate updated successfully!');
      fetchRateData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold mb-4">Exchange Rate Settings</h1>
        <div className="text-center text-slate-500">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold mb-4">Exchange Rate Settings</h1>
      
      <div className="card max-w-md p-6">
        <h2 className="text-lg font-semibold mb-4 text-slate-200">Set Current Exchange Rate (USD to RMB)</h2>
        
        {error && <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-500 rounded-lg text-sm mb-4">{error}</div>}
        {message && <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-500 rounded-lg text-sm mb-4">{message}</div>}

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="label mb-1">RMB per 1 USD (e.g., 7.30)</label>
            <input
              type="number"
              step="0.0001"
              disabled={saving || !isOwner}
              className="input w-full"
              placeholder="e.g. 7.3"
              value={rate}
              onChange={e => setRate(e.target.value)}
              data-testid="exchange-rate-input"
              required
            />
          </div>

          {isOwner ? (
            <button
              type="submit"
              disabled={saving}
              className="btn btn-primary w-full"
              data-testid="exchange-rate-save"
            >
              {saving ? 'Saving...' : 'Save Exchange Rate'}
            </button>
          ) : (
            <div className="p-3 bg-slate-800 border border-slate-700 text-slate-400 rounded-lg text-sm">
              🔒 Only Owners can update the exchange rate.
            </div>
          )}
        </form>
      </div>

      <div className="card p-6">
        <h2 className="text-lg font-semibold mb-4 text-slate-200">Exchange Rate History</h2>
        <div className="table-container">
          <table className="table w-full" data-testid="exchange-rate-history-table">
            <thead>
              <tr className="bg-slate-800 text-slate-300">
                <th className="p-2 text-left">Date</th>
                <th className="p-2 text-right">Exchange Rate</th>
                <th className="p-2 text-left">Created By</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h: any) => (
                <tr key={h.id} className="border-t border-slate-700 hover:bg-slate-800/30" data-testid="exchange-rate-history-row">
                  <td className="p-2 text-slate-400">{new Date(h.createdAt).toLocaleString()}</td>
                  <td className="p-2 text-right text-emerald-400 font-bold font-mono">{Number(h.rate).toFixed(4)}</td>
                  <td className="p-2 text-slate-400">{h.createdBy || 'System'}</td>
                </tr>
              ))}
              {!history.length && (
                <tr>
                  <td colSpan={3} className="p-4 text-center text-slate-500">No exchange rate history found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
