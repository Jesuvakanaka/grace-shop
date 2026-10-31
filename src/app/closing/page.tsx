'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';

export default function DayClosingPage() {
  const { isOwner } = useAuth();
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // Form fields
  const [actualCountedCash, setActualCountedCash] = useState('0');
  const [stockNotes, setStockNotes] = useState('');
  const [signOffName, setSignOffName] = useState('');
  const [closingNotes, setClosingNotes] = useState('');

  useEffect(() => {
    fetchClosingData();
  }, [date]);

  const fetchClosingData = async () => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const res = await fetch(`/api/closing?date=${date}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed to fetch day closing status');
      setData(d);
      setActualCountedCash(String(d.actualCountedCash || d.expectedClosingCash || 0));
      setStockNotes(d.stockNotes || '');
      setSignOffName(d.signOffName || '');
      setClosingNotes(d.closingNotes || '');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveDraft = async () => {
    setError('');
    setMessage('');
    setSaving(true);
    try {
      const res = await fetch('/api/closing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dateStr: date,
          actualCountedCash: Number(actualCountedCash),
          stockNotes,
          signOffName,
          closingNotes
        })
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed to save closing draft');
      setData(d);
      setMessage('Closing draft saved successfully!');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleFinalize = async () => {
    if (!isOwner) {
      setError('Only owners can finalize the day closing.');
      return;
    }
    if (!signOffName) {
      setError('Manager sign-off name is required to finalize.');
      return;
    }
    setError('');
    setMessage('');
    setSaving(true);
    try {
      // 1. First save draft to make sure latest values are stored
      const draftRes = await fetch('/api/closing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dateStr: date,
          actualCountedCash: Number(actualCountedCash),
          stockNotes,
          signOffName,
          closingNotes
        })
      });
      const draftData = await draftRes.json();
      if (!draftRes.ok) throw new Error(draftData.error || 'Failed to save closing state');

      // 2. Finalize close
      const closeRes = await fetch(`/api/closing/${draftData.id}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signOffName,
          actualCountedCash: Number(actualCountedCash)
        })
      });
      const closeData = await closeRes.json();
      if (!closeRes.ok) throw new Error(closeData.error || 'Failed to finalize closing');

      setData(closeData);
      setMessage('Day closing locked and finalized!');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold">End-of-Day Closing Ledger</h1>
        <div className="text-center text-slate-500">Loading closing ledger...</div>
      </div>
    );
  }

  const isClosed = data?.status === 'CLOSED';

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">End-of-Day Closing Ledger</h1>
        <div data-testid="closing-status-badge">
          <span className={`px-3 py-1 rounded text-sm font-bold uppercase ${
            isClosed ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-amber-50 text-amber-800 border border-amber-200'
          }`} data-testid="closing-status">
            {data?.status || 'DRAFT'}
          </span>
        </div>
      </div>

      <div className="mb-4">
        <label className="label mb-1">Select Operations Date</label>
        <input 
          type="date" 
          className="input w-full max-w-xs" 
          value={date} 
          onChange={e => setDate(e.target.value)} 
          disabled={saving}
        />
      </div>

      {error && <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-sm max-w-xl">{error}</div>}
      {message && <div className="p-3 bg-brand-olive-50 border border-brand-olive-200 text-brand-olive-700 rounded-lg text-sm max-w-xl">{message}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card p-6 space-y-6">
          <h2 className="text-lg font-semibold text-slate-900">Daily Totals Summary (USD)</h2>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-3 bg-brand-cream-100 rounded-lg border border-slate-200">
              <span className="text-slate-500 text-xs">Opening Cash</span>
              <div className="text-lg font-bold font-mono text-slate-900 mt-1">{formatCurrency(data?.openingCash)}</div>
            </div>
            
            <div className="p-3 bg-brand-cream-100 rounded-lg border border-slate-200">
              <span className="text-slate-500 text-xs">Cash Sales</span>
              <div className="text-lg font-bold font-mono text-brand-olive mt-1">+{formatCurrency(data?.totalCashSales)}</div>
            </div>
            
            <div className="p-3 bg-brand-cream-100 rounded-lg border border-slate-200">
              <span className="text-slate-500 text-xs">Credit Sales</span>
              <div className="text-lg font-bold font-mono text-amber-700 mt-1">{formatCurrency(data?.totalCreditSales)}</div>
            </div>
            
            <div className="p-3 bg-brand-cream-100 rounded-lg border border-slate-200">
              <span className="text-slate-500 text-xs">Expenses Paid</span>
              <div className="text-lg font-bold font-mono text-rose-600 mt-1">-{formatCurrency(data?.totalExpenses)}</div>
            </div>

            <div className="p-3 bg-brand-cream-100 rounded-lg border border-slate-200">
              <span className="text-slate-500 text-xs">Debtors Received</span>
              <div className="text-lg font-bold font-mono text-brand-olive mt-1">+{formatCurrency(data?.debtorPaymentsReceived)}</div>
            </div>

            <div className="p-3 bg-brand-cream-100 rounded-lg border border-slate-200">
              <span className="text-slate-500 text-xs">Creditors Paid</span>
              <div className="text-lg font-bold font-mono text-rose-600 mt-1">-{formatCurrency(data?.creditorPaymentsMade)}</div>
            </div>

            <div className="p-3 bg-brand-cream-100 rounded-lg border border-slate-200">
              <span className="text-slate-500 text-xs">Items Sold Count</span>
              <div className="text-lg font-bold text-slate-900 mt-1">{data?.totalItemsSold || 0}</div>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-6 grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <span className="text-slate-500 text-sm">Expected Closing Cash</span>
              <div className="text-2xl font-extrabold text-brand-olive font-mono mt-1" data-testid="closing-expected-cash">
                {formatCurrency(data?.expectedClosingCash)}
              </div>
            </div>

            <div>
              <span className="text-slate-500 text-sm">Actual Counted Cash</span>
              <div className="text-2xl font-extrabold text-sky-700 font-mono mt-1">
                {formatCurrency(data?.actualCountedCash)}
              </div>
            </div>

            <div>
              <span className="text-slate-500 text-sm">Variance</span>
              <div className={`text-2xl font-extrabold font-mono mt-1 ${
                (data?.cashVariance || 0) < 0 ? 'text-rose-700' : (data?.cashVariance || 0) > 0 ? 'text-amber-700' : 'text-brand-olive'
              }`} data-testid="closing-variance">
                {formatCurrency(data?.cashVariance)}
              </div>
            </div>
          </div>
        </div>

        <div className="card p-6" data-testid="closing-form">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">{isClosed ? 'Signoff Details (🔒 Locked)' : 'Finalize Day Closing'}</h2>
          
          <div className="space-y-4">
            <div>
              <label className="label mb-1">Actual Counted Cash (USD)</label>
              <input
                type="number"
                step="0.01"
                className="input w-full"
                value={actualCountedCash}
                onChange={e => setActualCountedCash(e.target.value)}
                disabled={saving || isClosed}
                required
                data-testid="closing-actual-cash"
              />
            </div>

            <div>
              <label className="label mb-1">Manager Sign-off Name</label>
              <input
                type="text"
                className="input w-full"
                value={signOffName}
                onChange={e => setSignOffName(e.target.value)}
                disabled={saving || isClosed}
                required
                placeholder="Manager signature name"
                data-testid="closing-signoff-name"
              />
            </div>

            <div>
              <label className="label mb-1">Stock Verification Notes</label>
              <textarea
                className="input w-full"
                value={stockNotes}
                onChange={e => setStockNotes(e.target.value)}
                disabled={saving || isClosed}
                placeholder="e.g. Physical counts matching..."
              />
            </div>

            <div>
              <label className="label mb-1">Closing Remarks</label>
              <textarea
                className="input w-full"
                value={closingNotes}
                onChange={e => setClosingNotes(e.target.value)}
                disabled={saving || isClosed}
                placeholder="General notes..."
              />
            </div>

            {!isClosed && (
              <div className="flex gap-2 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={handleSaveDraft}
                  disabled={saving}
                  className="btn btn-secondary flex-1"
                  data-testid="closing-save-draft"
                >
                  Save Draft
                </button>
                {isOwner && (
                  <button
                    type="button"
                    onClick={handleFinalize}
                    disabled={saving || !signOffName}
                    className="btn btn-danger flex-1"
                    data-testid="closing-close-button"
                  >
                    Close Day
                  </button>
                )}
              </div>
            )}
            
            {isClosed && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-sm text-center font-bold">
                🔒 Day is closed and transaction editing is locked.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
