'use client';

import React, { useState, useEffect } from 'react';
import { MoneyNav } from '@/components/MoneyNav';

export default function DebtorsPage() {
  const [debtors, setDebtors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDebtor, setSelectedDebtor] = useState<any | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetchDebtors();
  }, []);

  const fetchDebtors = async () => {
    try {
      const res = await fetch('/api/debtors');
      const data = await res.json();
      if (res.ok) setDebtors(data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenPaymentModal = (debtor: any) => {
    setSelectedDebtor(debtor);
    setPaymentAmount('');
    setNotes('');
    setError('');
    setMessage('');
  };

  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDebtor) return;
    if (!paymentAmount || isNaN(Number(paymentAmount)) || Number(paymentAmount) <= 0) {
      setError('Please enter a valid payment amount');
      return;
    }
    setError('');
    setSubmitting(true);

    try {
      const res = await fetch(`/api/debtors/${selectedDebtor.id}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Number(paymentAmount),
          notes
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit debtor payment');

      setMessage('Payment recorded successfully!');
      setSelectedDebtor(null);
      fetchDebtors();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);

  if (loading) {
    return (
      <div className="p-4 lg:p-6 space-y-4 max-w-4xl mx-auto">
        <h1 className="text-xl lg:text-2xl font-bold text-slate-900">Debtors Directory</h1>
        <div className="text-center text-slate-500">Loading debtors...</div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-4xl mx-auto">
      <h1 className="text-xl lg:text-2xl font-bold text-slate-900">Debtors Directory</h1>
      <MoneyNav />

      {message && <div className="p-3 bg-brand-olive-50 border border-brand-olive-200 text-brand-olive-700 rounded-lg text-sm max-w-xl">{message}</div>}

      <div className="card table-container">
        {/* Mobile card list */}
        <div className="md:hidden space-y-2 p-2">
          {debtors.map((d: any) => (
            <div key={d.id} className="list-row flex-col items-stretch gap-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-slate-900">{d.customerName}</p>
                  <p className="text-sm text-slate-500">{d.customerPhone || 'No phone'}</p>
                </div>
                <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase shrink-0 ${
                  d.status === 'PAID' ? 'bg-brand-olive-50 text-brand-olive-700' :
                  d.status === 'PART_PAID' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'
                }`}>
                  {d.status}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-bold font-mono text-amber-600">{formatCurrency(d.outstandingBalance)}</span>
                <button
                  disabled={d.outstandingBalance <= 0}
                  onClick={() => handleOpenPaymentModal(d)}
                  className="btn btn-sm btn-primary"
                >
                  Receive Payment
                </button>
              </div>
            </div>
          ))}
          {!debtors.length && (
            <div className="text-center text-slate-500 py-8">No debtor accounts registered.</div>
          )}
        </div>

        {/* Desktop table. Visibility lives on a wrapper: the `table` class is also
            Tailwind's display:table utility, which overrode `hidden` on the table itself. */}
        <div className="hidden md:block">
        <table className="table w-full" data-testid="debtors-table">
          <thead>
            <tr className="bg-slate-50 text-slate-600">
              <th className="p-2 text-left">Customer Name</th>
              <th className="p-2 text-left">Customer Phone</th>
              <th className="p-2 text-right">Outstanding Balance</th>
              <th className="p-2 text-center">Status</th>
              <th className="p-2 text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {debtors.map((d: any) => (
              <tr key={d.id} className="border-t border-slate-200" data-testid="debtor-row" data-customer-name={d.customerName}>
                <td className="p-2 text-slate-900 font-medium">{d.customerName}</td>
                <td className="p-2 text-slate-500">{d.customerPhone || 'N/A'}</td>
                <td className="p-2 text-right text-amber-600 font-bold font-mono" data-testid="debtor-row-balance">
                  {formatCurrency(d.outstandingBalance)}
                </td>
                <td className="p-2 text-center">
                  <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${
                    d.status === 'PAID' ? 'bg-brand-olive-50 text-brand-olive-700' :
                    d.status === 'PART_PAID' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'
                  }`}>
                    {d.status}
                  </span>
                </td>
                <td className="p-2 text-center">
                  <button
                    disabled={d.outstandingBalance <= 0}
                    onClick={() => handleOpenPaymentModal(d)}
                    className="btn btn-sm btn-primary"
                    data-testid="debtor-record-payment"
                  >
                    Receive Payment
                  </button>
                </td>
              </tr>
            ))}
            {!debtors.length && (
              <tr>
                <td colSpan={5} className="p-4 text-center text-slate-500">No debtor accounts registered.</td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {selectedDebtor && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="card p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-2">Record Payment</h2>
            <p className="text-sm text-slate-400 mb-4">
              Recording payment for customer <strong className="text-slate-200">{selectedDebtor.customerName}</strong>. Outstanding balance: <strong className="text-slate-200">{formatCurrency(selectedDebtor.outstandingBalance)}</strong>.
            </p>
            
            {error && <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-500 rounded-lg text-sm mb-4">{error}</div>}

            <form onSubmit={handlePaymentSubmit} className="space-y-4" data-testid="debtor-payment-form">
              <div>
                <label className="label mb-1">Payment Amount (USD)</label>
                <input
                  type="number"
                  step="0.01"
                  className="input w-full"
                  value={paymentAmount}
                  onChange={e => setPaymentAmount(e.target.value)}
                  disabled={submitting}
                  required
                  data-testid="debtor-payment-amount"
                  placeholder="e.g. 50.00"
                />
              </div>

              <div>
                <label className="label mb-1">Notes</label>
                <textarea
                  className="input w-full"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  disabled={submitting}
                  placeholder="Payment remarks..."
                />
              </div>

              <div className="flex justify-end space-x-2 mt-6">
                <button 
                  type="button" 
                  className="btn btn-ghost" 
                  onClick={() => setSelectedDebtor(null)}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn btn-primary" 
                  disabled={submitting}
                  data-testid="debtor-payment-submit"
                >
                  {submitting ? 'Recording...' : 'Record Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
