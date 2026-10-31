'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { MoneyNav } from '@/components/MoneyNav';

export default function CashPositionPage() {
  const { isOwner } = useAuth();
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // Form fields
  const [openingCash, setOpeningCash] = useState('0');
  const [actualCountedCash, setActualCountedCash] = useState('0');
  const [otherCashIn, setOtherCashIn] = useState('0');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    fetchCashData();
  }, [date]);

  const fetchCashData = async () => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const res = await fetch(`/api/cash?date=${date}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed to fetch cash position');
      setData(d);
      setOpeningCash(String(d.openingCash || 0));
      setActualCountedCash(String(d.actualCountedCash || 0));
      setOtherCashIn(String(d.otherCashIn || 0));
      setNotes(d.notes || '');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setSaving(true);
    try {
      const res = await fetch('/api/cash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          fields: {
            openingCash: Number(openingCash),
            actualCountedCash: Number(actualCountedCash),
            otherCashIn: Number(otherCashIn),
            notes: notes
          }
        })
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed to save cash position');
      setData(d);
      setMessage('Cash position updated successfully!');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);

  if (loading) {
    return (
      <div className="p-4 lg:p-6 space-y-4 max-w-4xl mx-auto">
        <h1 className="text-xl lg:text-2xl font-bold text-slate-900">Cash Position Tracker</h1>
        <div className="p-8 text-center text-slate-500">Loading cash position...</div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-4xl mx-auto">
      <h1 className="text-xl lg:text-2xl font-bold text-slate-900">Cash Position Tracker</h1>
      <MoneyNav />

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="max-w-xs">
          <label className="label mb-1">Select Date</label>
          <input 
            type="date" 
            className="input w-full" 
            value={date} 
            onChange={e => setDate(e.target.value)} 
          />
        </div>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm max-w-xl">{error}</div>}
      {message && <div className="p-3 bg-brand-olive-50 border border-brand-olive-200 text-brand-olive-700 rounded-lg text-sm max-w-xl">{message}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card p-6 space-y-6">
          <h2 className="text-lg font-semibold text-slate-900">Daily Cash Position Details</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
              <span className="text-slate-500 text-xs">Opening Cash (USD)</span>
              <div className="text-xl font-bold font-mono mt-1 text-slate-900">{formatCurrency(data?.openingCash)}</div>
            </div>
            
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
              <span className="text-slate-500 text-xs">Cash Sales (USD)</span>
              <div className="text-xl font-bold font-mono mt-1 text-brand-olive">+{formatCurrency(data?.cashSales)}</div>
            </div>
            
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
              <span className="text-slate-500 text-xs">Debtor Payments Received (USD)</span>
              <div className="text-xl font-bold font-mono mt-1 text-brand-olive">+{formatCurrency(data?.debtorPaymentsReceived)}</div>
            </div>
            
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
              <span className="text-slate-500 text-xs">Other Cash In (USD)</span>
              <div className="text-xl font-bold font-mono mt-1 text-brand-olive">+{formatCurrency(data?.otherCashIn)}</div>
            </div>

            <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
              <span className="text-slate-500 text-xs">Expenses Paid (USD)</span>
              <div className="text-xl font-bold font-mono mt-1 text-rose-600">-{formatCurrency(data?.expensesPaid)}</div>
            </div>

            <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
              <span className="text-slate-500 text-xs">Creditor Payments Made (USD)</span>
              <div className="text-xl font-bold font-mono mt-1 text-rose-600">-{formatCurrency(data?.creditorPaymentsMade)}</div>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-6 flex flex-col md:flex-row gap-4 items-center justify-between">
            <div>
              <span className="text-slate-500 text-sm">Expected Closing Cash</span>
              <div className="text-3xl font-extrabold text-brand-olive font-mono mt-1" data-testid="cash-expected-closing">
                {formatCurrency(data?.expectedClosingCash)}
              </div>
            </div>

            <div>
              <span className="text-slate-500 text-sm">Actual Counted Cash</span>
              <div className="text-3xl font-extrabold text-blue-600 font-mono mt-1" data-testid="cash-actual-counted">
                {formatCurrency(data?.actualCountedCash)}
              </div>
            </div>

            <div>
              <span className="text-slate-500 text-sm">Variance</span>
              <div className={`text-3xl font-extrabold font-mono mt-1 ${
                (data?.variance || 0) < 0 ? 'text-rose-600' : (data?.variance || 0) > 0 ? 'text-amber-700' : 'text-brand-olive'
              }`} data-testid="cash-variance">
                {formatCurrency(data?.variance)}
              </div>
            </div>
          </div>
        </div>

        <div className="card p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Edit Cash Position</h2>
          
          <form onSubmit={handleUpdate} className="space-y-4" data-testid="cash-position-form">
            <div>
              <label className="label mb-1">Opening Cash (USD)</label>
              <input
                type="number"
                step="0.01"
                className="input w-full"
                value={openingCash}
                onChange={e => setOpeningCash(e.target.value)}
                disabled={saving || !isOwner}
                required
                data-testid="cash-opening-cash"
              />
            </div>

            <div>
              <label className="label mb-1">Other Cash In (USD)</label>
              <input
                type="number"
                step="0.01"
                className="input w-full"
                value={otherCashIn}
                onChange={e => setOtherCashIn(e.target.value)}
                disabled={saving}
              />
            </div>

            <div>
              <label className="label mb-1">Actual Counted Cash (USD)</label>
              <input
                type="number"
                step="0.01"
                className="input w-full"
                value={actualCountedCash}
                onChange={e => setActualCountedCash(e.target.value)}
                disabled={saving}
                required
                data-testid="cash-actual-input"
              />
            </div>

            <div>
              <label className="label mb-1">Notes / Discrepancies</label>
              <textarea
                className="input w-full h-24"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                disabled={saving}
                placeholder="Explain any variance..."
              />
            </div>

            <button type="submit" disabled={saving} className="btn btn-primary w-full" data-testid="cash-save-button">
              {saving ? 'Updating...' : 'Save Cash Position'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
