'use client';
import { useState, useEffect } from 'react';

export default function SalesPage() {
  const [sales, setSales] = useState<any[]>([]);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    fetch('/api/sales?date=' + date)
      .then(r => r.json())
      .then(d => setSales(d || []))
      .catch(() => {});
  }, [date]);

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Daily Sales Log</h1>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>New Sale</button>
      </div>

      <div className="mb-4">
        <input type="date" className="input" value={date} onChange={e => setDate(e.target.value)} />
      </div>

      <div className="card table-container">
        <table className="table w-full">
          <thead>
            <tr>
              <th className="text-left p-2">Date</th>
              <th className="text-left p-2">Product(s)</th>
              <th className="text-right p-2">Qty</th>
              <th className="text-right p-2">Unit Price</th>
              <th className="text-right p-2">Total</th>
              <th className="text-center p-2">Payment Type</th>
              <th className="text-left p-2">Customer</th>
            </tr>
          </thead>
          <tbody>
            {sales.map(s => (
              <tr key={s.id} className="border-t border-gray-700">
                <td className="p-2">{s.date}</td>
                <td className="p-2">{s.productName}</td>
                <td className="text-right p-2">{s.qty}</td>
                <td className="text-right p-2">{formatCurrency(s.unitPrice)}</td>
                <td className="text-right p-2">{formatCurrency(s.total)}</td>
                <td className="text-center p-2">
                  <span className={`badge ${s.paymentType === 'CASH' ? 'badge-success' : s.paymentType === 'CREDIT' ? 'badge-warning' : 'badge-info'}`}>
                    {s.paymentType}
                  </span>
                </td>
                <td className="p-2">{s.customer}</td>
              </tr>
            ))}
            {!sales.length && <tr><td colSpan={7} className="p-4 text-center text-gray-400">No sales for this date</td></tr>}
          </tbody>
        </table>
      </div>
      
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="card p-6 w-full max-w-lg">
            <h2 className="text-xl font-bold mb-4">New Sale</h2>
            <form className="space-y-4">
              {/* Form fields here */}
              <p>Form placeholder</p>
              <div className="flex justify-end space-x-2 mt-6">
                <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save Sale</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
