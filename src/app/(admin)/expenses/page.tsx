'use client';

import React, { useState, useEffect } from 'react';
import { MoneyNav } from '@/components/MoneyNav';

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<any[]>([]);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    fetch('/api/expenses?date=' + date)
      .then(res => res.json())
      .then(data => setExpenses(data || []))
      .catch(() => {});
  }, [date]);

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-4xl mx-auto">
      <h1 className="text-xl lg:text-2xl font-bold text-slate-900">Daily Expenses Log</h1>
      <MoneyNav />

      <div className="mb-4">
        <label className="label mb-1">Filter by Date</label>
        <input
          type="date"
          className="input w-full max-w-xs"
          value={date}
          onChange={e => setDate(e.target.value)}
        />
      </div>

      <div className="card table-container">
        {/* Mobile card list */}
        <div className="md:hidden space-y-2 p-2">
          {expenses.map((e: any) => (
            <div key={e.id} className="list-row flex-col items-stretch gap-1">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-900">{e.category}</span>
                <span className="font-bold font-mono text-rose-600">{formatCurrency(e.amount)}</span>
              </div>
              <p className="text-sm text-slate-600">{e.description}</p>
              <p className="text-xs text-slate-500">
                {e.paidTo || 'N/A'} · {e.paymentMethod}
              </p>
            </div>
          ))}
          {!expenses.length && (
            <div className="text-center text-slate-500 py-8">No expenses recorded for this date.</div>
          )}
        </div>

        {/* Desktop table. Visibility lives on a wrapper: the `table` class is also
            Tailwind's display:table utility, which overrode `hidden` on the table itself. */}
        <div className="hidden md:block">
        <table className="table w-full" data-testid="expenses-table">
          <thead>
            <tr className="bg-slate-50 text-slate-600">
              <th className="p-2 text-left">Category</th>
              <th className="p-2 text-left">Description</th>
              <th className="p-2 text-left">Paid To</th>
              <th className="p-2 text-center">Payment Method</th>
              <th className="p-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {expenses.map((e: any) => (
              <tr key={e.id} className="border-t border-slate-200" data-testid="expense-row">
                <td className="p-2 text-slate-900 font-medium">{e.category}</td>
                <td className="p-2 text-slate-700">{e.description}</td>
                <td className="p-2 text-slate-500">{e.paidTo || 'N/A'}</td>
                <td className="p-2 text-center text-slate-500 text-xs font-mono">{e.paymentMethod}</td>
                <td className="p-2 text-right text-rose-600 font-bold font-mono" data-testid="expense-row-amount">
                  {formatCurrency(e.amount)}
                </td>
              </tr>
            ))}
            {!expenses.length && (
              <tr>
                <td colSpan={5} className="p-4 text-center text-slate-500">No expenses recorded for this date.</td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
