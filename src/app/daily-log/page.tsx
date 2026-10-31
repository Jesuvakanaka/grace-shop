'use client';

import React, { useState, useEffect } from 'react';

export default function DailyLogPage() {
  const [activeTab, setActiveTab] = useState<'sales' | 'expenses' | 'debtors' | 'creditors'>('sales');
  
  // Dynamic datasets for select options
  const [products, setProducts] = useState<any[]>([]);
  const [debtors, setDebtors] = useState<any[]>([]);
  const [creditors, setCreditors] = useState<any[]>([]);
  
  // Status feedback
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Sales Form State
  const [saleProductId, setSaleProductId] = useState('');
  const [saleQuantity, setSaleQuantity] = useState('1');
  const [salePaymentType, setSalePaymentType] = useState('CASH');
  const [saleCustomerName, setSaleCustomerName] = useState('');
  const [saleCustomerPhone, setSaleCustomerPhone] = useState('');
  const [saleNotes, setSaleNotes] = useState('');

  // Expenses Form State
  const [expenseCategory, setExpenseCategory] = useState('Transport');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expensePaidTo, setExpensePaidTo] = useState('');
  const [expenseDescription, setExpenseDescription] = useState('');
  const [expensePaymentMethod, setExpensePaymentMethod] = useState('CASH');
  const [expenseNotes, setExpenseNotes] = useState('');

  // Debtor Form State
  const [debtorId, setDebtorId] = useState('');
  const [debtorPaymentAmount, setDebtorPaymentAmount] = useState('');
  const [debtorNotes, setDebtorNotes] = useState('');

  // Creditor Form State
  const [creditorId, setCreditorId] = useState('');
  const [creditorPaymentAmount, setCreditorPaymentAmount] = useState('');
  const [creditorNotes, setCreditorNotes] = useState('');

  useEffect(() => {
    fetchFormData();
  }, []);

  const fetchFormData = async () => {
    try {
      const prodRes = await fetch('/api/products');
      const prodData = await prodRes.json();
      if (prodRes.ok) setProducts(prodData || []);

      const debtRes = await fetch('/api/debtors');
      const debtData = await debtRes.json();
      if (debtRes.ok) setDebtors(debtData || []);

      const credRes = await fetch('/api/creditors');
      const credData = await credRes.json();
      if (credRes.ok) setCreditors(credData || []);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    
    const prod = products.find(p => p.id === Number(saleProductId));
    if (!prod) {
      setError('Please select a product');
      return;
    }

    setSubmitting(true);
    try {
      // Calculate USD pricing on submission
      const totalAmount = prod.sellingPriceUsd * Number(saleQuantity);
      const isCredit = salePaymentType === 'CREDIT';
      
      const payload = {
        saleDate: new Date(),
        paymentType: salePaymentType,
        customerName: isCredit ? saleCustomerName : (saleCustomerName || null),
        customerPhone: saleCustomerPhone || null,
        cashAmount: isCredit ? 0 : totalAmount,
        creditAmount: isCredit ? totalAmount : 0,
        notes: saleNotes || null,
        items: [
          {
            productId: prod.id,
            quantity: Number(saleQuantity),
            unitPrice: prod.sellingPriceUsd
          }
        ]
      };

      const res = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit sale');

      setMessage('Sale recorded successfully!');
      setSaleProductId('');
      setSaleQuantity('1');
      setSaleCustomerName('');
      setSaleCustomerPhone('');
      setSaleNotes('');
      fetchFormData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleExpenseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setSubmitting(true);

    try {
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expenseDate: new Date(),
          category: expenseCategory,
          description: expenseDescription,
          amount: Number(expenseAmount),
          paymentMethod: expensePaymentMethod,
          paidTo: expensePaidTo || null,
          notes: expenseNotes || null
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit expense');

      setMessage('Expense recorded successfully!');
      setExpenseAmount('');
      setExpenseDescription('');
      setExpensePaidTo('');
      setExpenseNotes('');
      fetchFormData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDebtorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    if (!debtorId) {
      setError('Please select a debtor');
      return;
    }
    setSubmitting(true);

    try {
      const res = await fetch(`/api/debtors/${debtorId}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Number(debtorPaymentAmount),
          notes: debtorNotes || null
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to record debtor payment');

      setMessage('Debtor payment received successfully!');
      setDebtorId('');
      setDebtorPaymentAmount('');
      setDebtorNotes('');
      fetchFormData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreditorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    if (!creditorId) {
      setError('Please select a creditor');
      return;
    }
    setSubmitting(true);

    try {
      const res = await fetch(`/api/creditors/${creditorId}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: Number(creditorPaymentAmount),
          notes: creditorNotes || null
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to record creditor payment');

      setMessage('Creditor payment made successfully!');
      setCreditorId('');
      setCreditorPaymentAmount('');
      setCreditorNotes('');
      fetchFormData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold mb-4">Daily Operations Log</h1>

      <div className="flex gap-1 p-1 bg-slate-100 rounded-xl overflow-x-auto mb-4">
        {([
          ['sales', '🛒 Record Sale'],
          ['expenses', '💸 Record Expense'],
          ['debtors', '👥 Debtor Payment'],
          ['creditors', '🏢 Creditor Payment'],
        ] as const).map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            onClick={() => { setActiveTab(tab); setError(''); setMessage(''); }}
            className={`flex-1 min-w-[80px] py-2 px-3 rounded-lg text-sm font-medium whitespace-nowrap ${
              activeTab === tab ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-500 rounded-lg text-sm max-w-lg">{error}</div>}
      {message && <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-500 rounded-lg text-sm max-w-lg">{message}</div>}

      <div className="card p-6 max-w-lg">
        {activeTab === 'sales' && (
          <form onSubmit={handleSaleSubmit} className="space-y-4" data-testid="daily-log-sale-form">
            <h2 className="text-lg font-semibold text-slate-200">Record a New Sale</h2>
            <div>
              <label className="label">Select Product</label>
              <select 
                className="input w-full bg-slate-800" 
                value={saleProductId} 
                onChange={e => setSaleProductId(e.target.value)} 
                required
                data-testid="sale-product-select"
              >
                <option value="">-- Choose Product --</option>
                {products.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.itemNumber} - {p.productName} (Stock: {p.currentQuantity})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Quantity</label>
                <input 
                  type="number" 
                  min="1" 
                  className="input w-full" 
                  value={saleQuantity} 
                  onChange={e => setSaleQuantity(e.target.value)} 
                  required
                  data-testid="sale-quantity-input"
                />
              </div>
              <div>
                <label className="label">Payment Type</label>
                <select 
                  className="input w-full bg-slate-800" 
                  value={salePaymentType} 
                  onChange={e => setSalePaymentType(e.target.value)}
                  data-testid="sale-payment-type"
                >
                  <option value="CASH">CASH</option>
                  <option value="CREDIT">CREDIT</option>
                </select>
              </div>
            </div>

            {salePaymentType === 'CREDIT' && (
              <div className="space-y-4 border-l-2 border-amber-500 pl-4">
                <div>
                  <label className="label">Customer Name</label>
                  <input 
                    type="text" 
                    className="input w-full" 
                    value={saleCustomerName} 
                    onChange={e => setSaleCustomerName(e.target.value)} 
                    required={salePaymentType === 'CREDIT'}
                    placeholder="Enter customer name"
                    data-testid="sale-customer-name"
                  />
                </div>
                <div>
                  <label className="label">Customer Phone</label>
                  <input 
                    type="text" 
                    className="input w-full" 
                    value={saleCustomerPhone} 
                    onChange={e => setSaleCustomerPhone(e.target.value)} 
                    placeholder="e.g. 1234567890"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="label">Notes</label>
              <textarea 
                className="input w-full" 
                value={saleNotes} 
                onChange={e => setSaleNotes(e.target.value)} 
                placeholder="Optional notes"
              />
            </div>

            <button type="submit" disabled={submitting} className="btn btn-primary w-full" data-testid="sale-submit">
              {submitting ? 'Recording Sale...' : 'Submit Sale'}
            </button>
          </form>
        )}

        {activeTab === 'expenses' && (
          <form onSubmit={handleExpenseSubmit} className="space-y-4" data-testid="expense-form">
            <h2 className="text-lg font-semibold text-slate-200">Record a Business Expense</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Category</label>
                <select 
                  className="input w-full bg-slate-800" 
                  value={expenseCategory} 
                  onChange={e => setExpenseCategory(e.target.value)}
                  data-testid="expense-category"
                >
                  <option value="Transport">Transport</option>
                  <option value="Logistics">Logistics</option>
                  <option value="Utilities">Utilities</option>
                  <option value="Rent">Rent</option>
                  <option value="Supplies">Supplies</option>
                  <option value="Salary">Salary</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className="label">Amount (USD)</label>
                <input 
                  type="number" 
                  step="0.01" 
                  className="input w-full" 
                  value={expenseAmount} 
                  onChange={e => setExpenseAmount(e.target.value)} 
                  required
                  data-testid="expense-amount"
                />
              </div>
            </div>
            <div>
              <label className="label">Paid To</label>
              <input 
                type="text" 
                className="input w-full" 
                value={expensePaidTo} 
                onChange={e => setExpensePaidTo(e.target.value)} 
                placeholder="Vendor or recipient"
              />
            </div>
            <div>
              <label className="label">Description</label>
              <input 
                type="text" 
                className="input w-full" 
                value={expenseDescription} 
                onChange={e => setExpenseDescription(e.target.value)} 
                required
                placeholder="Clear reason for expense"
              />
            </div>
            <div>
              <label className="label">Payment Method</label>
              <select 
                className="input w-full bg-slate-800" 
                value={expensePaymentMethod} 
                onChange={e => setExpensePaymentMethod(e.target.value)}
              >
                <option value="CASH">CASH</option>
                <option value="BANK">BANK</option>
              </select>
            </div>
            <button type="submit" disabled={submitting} className="btn btn-primary w-full" data-testid="expense-submit">
              {submitting ? 'Recording Expense...' : 'Submit Expense'}
            </button>
          </form>
        )}

        {activeTab === 'debtors' && (
          <form onSubmit={handleDebtorSubmit} className="space-y-4" data-testid="debtor-payment-form">
            <h2 className="text-lg font-semibold text-slate-200">Record Debtor Payment Received</h2>
            <div>
              <label className="label">Select Debtor</label>
              <select 
                className="input w-full bg-slate-800" 
                value={debtorId} 
                onChange={e => setDebtorId(e.target.value)} 
                required
              >
                <option value="">-- Choose Debtor Customer --</option>
                {debtors.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.customerName} (Owed: ${Number(d.outstandingBalance).toFixed(2)})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Payment Amount (USD)</label>
              <input 
                type="number" 
                step="0.01" 
                className="input w-full" 
                value={debtorPaymentAmount} 
                onChange={e => setDebtorPaymentAmount(e.target.value)} 
                required
                data-testid="debtor-payment-amount"
              />
            </div>
            <div>
              <label className="label">Notes</label>
              <textarea 
                className="input w-full" 
                value={debtorNotes} 
                onChange={e => setDebtorNotes(e.target.value)} 
              />
            </div>
            <button type="submit" disabled={submitting} className="btn btn-primary w-full" data-testid="debtor-submit">
              {submitting ? 'Recording Payment...' : 'Receive Payment'}
            </button>
          </form>
        )}

        {activeTab === 'creditors' && (
          <form onSubmit={handleCreditorSubmit} className="space-y-4" data-testid="creditor-payment-form">
            <h2 className="text-lg font-semibold text-slate-200">Record Creditor Payment Made</h2>
            <div>
              <label className="label">Select Creditor</label>
              <select 
                className="input w-full bg-slate-800" 
                value={creditorId} 
                onChange={e => setCreditorId(e.target.value)} 
                required
              >
                <option value="">-- Choose Supplier Creditor --</option>
                {creditors.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.creditorName} (Owed: ${Number(c.outstandingBalance).toFixed(2)})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Payment Amount (USD)</label>
              <input 
                type="number" 
                step="0.01" 
                className="input w-full" 
                value={creditorPaymentAmount} 
                onChange={e => setCreditorPaymentAmount(e.target.value)} 
                required
                data-testid="creditor-payment-amount"
              />
            </div>
            <div>
              <label className="label">Notes</label>
              <textarea 
                className="input w-full" 
                value={creditorNotes} 
                onChange={e => setCreditorNotes(e.target.value)} 
              />
            </div>
            <button type="submit" disabled={submitting} className="btn btn-primary w-full" data-testid="creditor-submit">
              {submitting ? 'Recording Payment...' : 'Make Payment'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
