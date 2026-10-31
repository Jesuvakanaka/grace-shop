'use client';

import React, { useState, useEffect } from 'react';

export default function SalesPage() {
  const [sales, setSales] = useState<any[]>([]);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    fetch('/api/sales?date=' + date)
      .then(r => r.json())
      .then(d => setSales(d || []))
      .catch(() => {});
  }, [date]);

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-4xl mx-auto">
      <h1 className="text-xl lg:text-2xl font-bold text-slate-900">Daily Sales Log</h1>

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
          {sales.map((s) => (
            <div key={s.id} className="list-row flex-col items-stretch gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-500">
                  {new Date(s.saleDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${
                  s.paymentType === 'CASH' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                }`}>
                  {s.paymentType}
                </span>
              </div>
              <p className="font-medium text-slate-900">{s.customerName || 'Walk-in'}</p>
              <div className="text-sm text-slate-600 space-y-0.5">
                {s.items?.map((item: any) => (
                  <div key={item.id}>
                    {item.product?.productName || 'Product'} ×{item.quantity} ({formatCurrency(item.unitPrice)})
                  </div>
                ))}
              </div>
              <p className="text-right font-bold font-mono text-emerald-600">{formatCurrency(s.totalAmount)}</p>
            </div>
          ))}
          {!sales.length && (
            <div className="text-center text-slate-500 py-8">No sales recorded for this date.</div>
          )}
        </div>

        {/* Desktop table */}
        <table className="table w-full hidden md:table" data-testid="sidebar-sales-table">
          <thead>
            <tr className="bg-slate-50 text-slate-600">
              <th className="p-2 text-left">Date</th>
              <th className="p-2 text-left">Customer</th>
              <th className="p-2 text-left">Items Sold</th>
              <th className="p-2 text-center">Payment Type</th>
              <th className="p-2 text-right">Total Amount</th>
            </tr>
          </thead>
          <tbody>
            {sales.map(s => (
              <tr key={s.id} className="border-t border-slate-200" data-testid="sales-log-row">
                <td className="p-2 text-slate-500">{new Date(s.saleDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                <td className="p-2 text-slate-900">{s.customerName || 'Walk-in'}</td>
                <td className="p-2 text-slate-700">
                  <div className="space-y-1">
                    {s.items?.map((item: any) => (
                      <div key={item.id} className="text-xs">
                        • {item.product?.productName || 'Product'} x{item.quantity} ({formatCurrency(item.unitPrice)})
                      </div>
                    ))}
                  </div>
                </td>
                <td className="p-2 text-center">
                  <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${
                    s.paymentType === 'CASH' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                  }`}>
                    {s.paymentType}
                  </span>
                </td>
                <td className="p-2 text-right text-emerald-600 font-bold font-mono" data-testid="sales-log-row-total">
                  {formatCurrency(s.totalAmount)}
                </td>
              </tr>
            ))}
            {!sales.length && (
              <tr>
                <td colSpan={5} className="p-4 text-center text-slate-500">No sales recorded for this date.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
