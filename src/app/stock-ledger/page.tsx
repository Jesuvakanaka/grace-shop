'use client';

import React, { useState, useEffect } from 'react';

export default function StockLedgerPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [movements, setMovements] = useState<any[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [loadingMovements, setLoadingMovements] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/products')
      .then(res => res.json())
      .then(data => {
        setProducts(data || []);
        if (data && data.length > 0) {
          setSelectedProductId(String(data[0].id));
        }
        setLoadingProducts(false);
      })
      .catch(() => setLoadingProducts(false));
  }, []);

  useEffect(() => {
    if (!selectedProductId) return;
    setLoadingMovements(true);
    setError('');
    fetch(`/api/stock-movements?productId=${selectedProductId}`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch stock movements');
        return res.json();
      })
      .then(data => {
        setMovements(data || []);
        setLoadingMovements(false);
      })
      .catch((err: any) => {
        setError(err.message);
        setLoadingMovements(false);
      });
  }, [selectedProductId]);

  const movementBadgeClass = (type: string) => {
    if (type === 'OPENING_BALANCE') return 'bg-slate-100 text-slate-600';
    if (type === 'STOCK_IN' || type === 'PURCHASE') return 'bg-emerald-50 text-emerald-700';
    if (type === 'SALE') return 'bg-blue-50 text-blue-700';
    return 'bg-amber-50 text-amber-700';
  };

  if (loadingProducts) {
    return (
      <div className="p-4 lg:p-6 space-y-6 max-w-4xl mx-auto">
        <h1 className="text-xl lg:text-2xl font-bold text-slate-900">Stock Ledger Movement Log</h1>
        <div className="text-center text-slate-500">Loading stock ledger...</div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-4xl mx-auto">
      <h1 className="text-xl lg:text-2xl font-bold text-slate-900">Stock Ledger Movement Log</h1>

      <div className="card p-4">
        <label className="label mb-1">Select Product to Inspect</label>
        <select
          className="input w-full"
          value={selectedProductId}
          onChange={e => setSelectedProductId(e.target.value)}
          data-testid="stock-ledger-select"
        >
          <option value="">-- Choose Product --</option>
          {products.map(p => (
            <option key={p.id} value={p.id}>
              {p.itemNumber} - {p.productName} (Current Stock: {p.currentQuantity})
            </option>
          ))}
        </select>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm max-w-xl">{error}</div>}

      <div className="card table-container">
        {loadingMovements ? (
          <div className="text-center p-8 text-slate-500">Loading movements list...</div>
        ) : (
          <>
            {/* Mobile card list */}
            <div className="md:hidden space-y-2 p-2">
              {movements.map((m: any) => (
                <div key={m.id} className="list-row flex-col items-stretch gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${movementBadgeClass(m.movementType)}`}>
                      {m.movementType?.replace('_', ' ')}
                    </span>
                    <span className="text-xs text-slate-500">
                      {new Date(m.movementDate).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between font-mono text-sm">
                    <span className={m.quantity > 0 ? 'text-emerald-600 font-bold' : m.quantity < 0 ? 'text-rose-600 font-bold' : 'text-slate-500'}>
                      {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                    </span>
                    <span className="text-slate-600">
                      {m.openingBalance} → <strong className="text-slate-900">{m.closingBalance}</strong>
                    </span>
                  </div>
                  {m.notes && <p className="text-xs text-slate-500">{m.notes}</p>}
                </div>
              ))}
              {!movements.length && (
                <div className="text-center text-slate-500 py-8">No stock movements found for this product.</div>
              )}
            </div>

            {/* Desktop table. Visibility lives on a wrapper: the `table` class is also
                Tailwind's display:table utility, which overrode `hidden` on the table itself. */}
            <div className="hidden md:block">
            <table className="table w-full" data-testid="stock-ledger-table">
              <thead>
                <tr className="bg-slate-50 text-slate-600">
                  <th className="p-2 text-left">Date</th>
                  <th className="p-2 text-left">Activity / Reference</th>
                  <th className="p-2 text-right">Adjustment Quantity</th>
                  <th className="p-2 text-right">Prev Balance</th>
                  <th className="p-2 text-right">New Balance</th>
                  <th className="p-2 text-left">Notes</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m: any) => (
                  <tr key={m.id} className="border-t border-slate-200" data-testid="stock-ledger-row">
                    <td className="p-2 text-slate-500">{new Date(m.movementDate).toLocaleString()}</td>
                    <td className="p-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${movementBadgeClass(m.movementType)}`}>
                        {m.movementType?.replace('_', ' ')}
                      </span>
                    </td>
                    <td className={`p-2 text-right font-bold font-mono ${
                      m.quantity > 0 ? 'text-emerald-600' : m.quantity < 0 ? 'text-rose-600' : 'text-slate-500'
                    }`}>
                      {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                    </td>
                    <td className="p-2 text-right text-slate-500 font-mono">{m.openingBalance}</td>
                    <td className="p-2 text-right text-slate-900 font-bold font-mono">{m.closingBalance}</td>
                    <td className="p-2 text-slate-500 text-sm">{m.notes || 'N/A'}</td>
                  </tr>
                ))}
                {!movements.length && (
                  <tr>
                    <td colSpan={6} className="p-4 text-center text-slate-500">No stock movements found for this product.</td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
