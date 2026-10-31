'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { MoneyNav } from '@/components/MoneyNav';

export default function CreditorsPage() {
  const { isOwner } = useAuth();
  const [creditors, setCreditors] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedCreditor, setSelectedCreditor] = useState<any | null>(null);

  // Add Creditor Form state
  const [newCreditorName, setNewCreditorName] = useState('');
  const [newOwedAmount, setNewOwedAmount] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newNotes, setNewNotes] = useState('');

  // Payment Form state
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');

  // Status state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetchCreditors();
  }, []);

  const fetchCreditors = async () => {
    try {
      const res = await fetch('/api/creditors');
      const data = await res.json();
      if (res.ok) setCreditors(data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCreditorName || !newOwedAmount || isNaN(Number(newOwedAmount))) {
      setError('Please fill in required fields');
      return;
    }
    setError('');
    setMessage('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/creditors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creditorName: newCreditorName,
          totalAmountOwed: Number(newOwedAmount),
          phoneNumber: newPhone || null,
          description: newDescription || null,
          notes: newNotes || null
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create creditor account');

      setMessage('Creditor account created successfully!');
      setShowAddModal(false);
      // Reset form
      setNewCreditorName('');
      setNewOwedAmount('');
      setNewPhone('');
      setNewDescription('');
      setNewNotes('');
      fetchCreditors();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCreditor) return;
    if (!paymentAmount || isNaN(Number(paymentAmount)) || Number(paymentAmount) <= 0) {
      setError('Please enter a valid payment amount');
      return;
    }
    setError('');
    setMessage('');
    setSubmitting(true);

    try {
      const res = await fetch(`/api/creditors/${selectedCreditor.id}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Number(paymentAmount),
          notes: paymentNotes
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to record payment');

      setMessage('Supplier payment recorded successfully!');
      setSelectedCreditor(null);
      fetchCreditors();
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
        <h1 className="text-xl lg:text-2xl font-bold text-slate-900">Creditors Registry</h1>
        <div className="text-center text-slate-500">Loading creditors...</div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-4xl mx-auto">
      <div className="flex justify-between items-center">
        <h1 className="text-xl lg:text-2xl font-bold text-slate-900">Creditors Registry</h1>
        {isOwner && (
          <button 
            onClick={() => { setShowAddModal(true); setError(''); setMessage(''); }} 
            className="btn btn-primary text-sm"
            data-testid="add-creditor-button"
          >
            Add Creditor Owed
          </button>
        )}
      </div>
      <MoneyNav />

      {message && <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg text-sm max-w-xl">{message}</div>}

      <div className="card table-container">
        {/* Mobile card list */}
        <div className="md:hidden space-y-2 p-2">
          {creditors.map((c: any) => (
            <div key={c.id} className="list-row flex-col items-stretch gap-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-slate-900">{c.creditorName}</p>
                  <p className="text-sm text-slate-600">{c.description || 'No description'}</p>
                  <p className="text-xs text-slate-500">{c.phoneNumber || 'No phone'}</p>
                </div>
                <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase shrink-0 ${
                  c.status === 'PAID' ? 'bg-emerald-50 text-emerald-700' :
                  c.status === 'PART_PAID' ? 'bg-blue-50 text-blue-700' : 'bg-red-50 text-red-700'
                }`}>
                  {c.status}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-bold font-mono text-rose-600">{formatCurrency(c.outstandingBalance)}</span>
                <button
                  disabled={c.outstandingBalance <= 0}
                  onClick={() => { setSelectedCreditor(c); setPaymentAmount(''); setPaymentNotes(''); setError(''); }}
                  className="btn btn-sm btn-primary"
                >
                  Record Payment
                </button>
              </div>
            </div>
          ))}
          {!creditors.length && (
            <div className="text-center text-slate-500 py-8">No supplier creditors owed.</div>
          )}
        </div>

        {/* Desktop table */}
        <table className="table w-full hidden md:table" data-testid="creditors-table">
          <thead>
            <tr className="bg-slate-50 text-slate-600">
              <th className="p-2 text-left">Supplier/Creditor</th>
              <th className="p-2 text-left">Description</th>
              <th className="p-2 text-left">Phone</th>
              <th className="p-2 text-right">Outstanding Balance</th>
              <th className="p-2 text-center">Status</th>
              <th className="p-2 text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {creditors.map((c: any) => (
              <tr key={c.id} className="border-t border-slate-200" data-testid="creditor-row" data-creditor-name={c.creditorName}>
                <td className="p-2 text-slate-900 font-medium">{c.creditorName}</td>
                <td className="p-2 text-slate-700">{c.description || 'N/A'}</td>
                <td className="p-2 text-slate-500">{c.phoneNumber || 'N/A'}</td>
                <td className="p-2 text-right text-rose-600 font-bold font-mono" data-testid="creditor-row-balance">
                  {formatCurrency(c.outstandingBalance)}
                </td>
                <td className="p-2 text-center">
                  <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${
                    c.status === 'PAID' ? 'bg-emerald-50 text-emerald-700' :
                    c.status === 'PART_PAID' ? 'bg-blue-50 text-blue-700' : 'bg-red-50 text-red-700'
                  }`}>
                    {c.status}
                  </span>
                </td>
                <td className="p-2 text-center">
                  <button
                    disabled={c.outstandingBalance <= 0}
                    onClick={() => { setSelectedCreditor(c); setPaymentAmount(''); setPaymentNotes(''); setError(''); }}
                    className="btn btn-sm btn-primary"
                    data-testid="creditor-record-payment"
                  >
                    Record Payment
                  </button>
                </td>
              </tr>
            ))}
            {!creditors.length && (
              <tr>
                <td colSpan={6} className="p-4 text-center text-slate-500">No supplier creditors owed.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="card p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Add Creditor</h2>
            {error && <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-500 rounded-lg text-sm mb-4">{error}</div>}
            
            <form onSubmit={handleAddSubmit} className="space-y-4">
              <div>
                <label className="label mb-1">Supplier Name</label>
                <input
                  type="text"
                  className="input w-full"
                  value={newCreditorName}
                  onChange={e => setNewCreditorName(e.target.value)}
                  required
                  data-testid="creditor-form-name"
                  placeholder="e.g. Supplier Bob"
                />
              </div>

              <div>
                <label className="label mb-1">Total Amount Owed (USD)</label>
                <input
                  type="number"
                  step="0.01"
                  className="input w-full"
                  value={newOwedAmount}
                  onChange={e => setNewOwedAmount(e.target.value)}
                  required
                  data-testid="creditor-form-owed"
                  placeholder="e.g. 200.00"
                />
              </div>

              <div>
                <label className="label mb-1">Phone Number</label>
                <input
                  type="text"
                  className="input w-full"
                  value={newPhone}
                  onChange={e => setNewPhone(e.target.value)}
                  placeholder="Optional phone"
                />
              </div>

              <div>
                <label className="label mb-1">Short Description</label>
                <input
                  type="text"
                  className="input w-full"
                  value={newDescription}
                  onChange={e => setNewDescription(e.target.value)}
                  placeholder="e.g. Stock order batch B"
                />
              </div>

              <div className="flex justify-end space-x-2 mt-6">
                <button 
                  type="button" 
                  className="btn btn-ghost" 
                  onClick={() => setShowAddModal(false)}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn btn-primary" 
                  disabled={submitting}
                  data-testid="creditor-form-submit"
                >
                  {submitting ? 'Saving...' : 'Add Creditor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedCreditor && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="card p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-2">Record Supplier Payment</h2>
            <p className="text-sm text-slate-400 mb-4">
              Recording payment to supplier <strong className="text-slate-200">{selectedCreditor.creditorName}</strong>. Balance outstanding: <strong className="text-slate-200">{formatCurrency(selectedCreditor.outstandingBalance)}</strong>.
            </p>
            
            {error && <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-500 rounded-lg text-sm mb-4">{error}</div>}

            <form onSubmit={handlePaymentSubmit} className="space-y-4" data-testid="creditor-payment-form">
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
                  data-testid="creditor-payment-amount"
                  placeholder="e.g. 80.00"
                />
              </div>

              <div>
                <label className="label mb-1">Notes</label>
                <textarea
                  className="input w-full"
                  value={paymentNotes}
                  onChange={e => setPaymentNotes(e.target.value)}
                  disabled={submitting}
                  placeholder="Payment remarks..."
                />
              </div>

              <div className="flex justify-end space-x-2 mt-6">
                <button 
                  type="button" 
                  className="btn btn-ghost" 
                  onClick={() => setSelectedCreditor(null)}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn btn-primary" 
                  disabled={submitting}
                  data-testid="creditor-payment-submit"
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
