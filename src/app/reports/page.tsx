'use client';

import React, { useState, useEffect } from 'react';

type ReportType = 'products' | 'sales' | 'expenses' | 'cash' | 'debtors' | 'creditors' | 'closing' | 'ledger';

export default function ReportsHubPage() {
  const [activeReport, setActiveReport] = useState<ReportType>('products');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [products, setProducts] = useState<any[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  
  // Report data states
  const [reportData, setReportData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Fetch product list for select options
  useEffect(() => {
    fetch('/api/products')
      .then(res => res.json())
      .then(data => {
        const productList = Array.isArray(data) ? data : [];
        setProducts(productList);
        if (productList.length > 0) {
          setSelectedProductId(String(productList[0].id));
        }
      })
      .catch(console.error);
  }, []);

  // Fetch active report data when parameters change
  useEffect(() => {
    fetchReportData();
  }, [activeReport, date, selectedProductId]);

  const fetchReportData = async () => {
    setLoading(true);
    setError('');
    setReportData(null);
    try {
      let url = '';
      if (activeReport === 'products') {
        url = '/api/products';
      } else if (activeReport === 'sales') {
        url = `/api/sales?date=${date}`;
      } else if (activeReport === 'expenses') {
        url = `/api/expenses?date=${date}`;
      } else if (activeReport === 'cash') {
        url = `/api/cash?date=${date}`;
      } else if (activeReport === 'debtors') {
        url = '/api/debtors';
      } else if (activeReport === 'creditors') {
        url = '/api/creditors';
      } else if (activeReport === 'closing') {
        url = `/api/closing?date=${date}`;
      } else if (activeReport === 'ledger') {
        if (!selectedProductId) return;
        url = `/api/stock-movements?productId=${selectedProductId}`;
      }

      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch report data');
      setReportData(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center no-print mb-4">
        <h1 className="text-2xl font-bold">Printable Reports Hub</h1>
        <button 
          onClick={handlePrint} 
          disabled={loading || !!error || !reportData}
          className="btn btn-primary"
          data-testid="print-report-button"
        >
          🖨️ Print Active Report
        </button>
      </div>

      {/* Selector Navigation */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2 no-print" data-testid="reports-list">
        {(['products', 'sales', 'expenses', 'cash', 'debtors', 'creditors', 'closing', 'ledger'] as ReportType[]).map((type) => (
          <button
            key={type}
            onClick={() => setActiveReport(type)}
            className={`px-3 py-2 rounded-lg text-xs font-semibold uppercase transition-colors text-center border ${
              activeReport === type 
                ? 'bg-emerald-600 border-emerald-500 text-white' 
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
            }`}
            data-testid={`report-tab-${type}`}
          >
            {type}
          </button>
        ))}
      </div>

      {/* Date / Params Selector */}
      <div className="card p-4 flex flex-wrap gap-4 items-center no-print">
        {['sales', 'expenses', 'cash', 'closing'].includes(activeReport) && (
          <div className="w-full max-w-xs">
            <label className="label text-xs mb-1">Select Date</label>
            <input 
              type="date" 
              className="input text-sm" 
              value={date} 
              onChange={e => setDate(e.target.value)} 
            />
          </div>
        )}

        {activeReport === 'ledger' && (
          <div className="w-full max-w-xs">
            <label className="label text-xs mb-1">Select Product</label>
            <select 
              className="input text-sm bg-slate-800" 
              value={selectedProductId} 
              onChange={e => setSelectedProductId(e.target.value)}
            >
              <option value="">-- Choose Product --</option>
              {products.map(p => (
                <option key={p.id} value={p.id}>{p.itemNumber} - {p.productName}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {error && <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-500 rounded-lg text-sm no-print">{error}</div>}

      {/* Printable Area */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 print:p-0 print:bg-white print:border-none" data-testid="report-printable-area">
        {loading ? (
          <div className="text-center p-8 text-slate-400 print:text-black">Generating print preview layout...</div>
        ) : !reportData ? (
          <div className="text-center p-8 text-slate-500 print:text-black">No report details found.</div>
        ) : (
          <div className="space-y-6">
            
            {/* Report Header */}
            <div className="border-b-2 border-slate-700 print:border-black pb-4 text-center">
              <h2 className="text-2xl font-bold tracking-tight text-slate-100 print:text-black uppercase">
                {activeReport === 'products' && 'Product stock book / Stock Master'}
                {activeReport === 'sales' && `Daily Sales Log — ${new Date(date).toLocaleDateString()}`}
                {activeReport === 'expenses' && `Daily Expenses Log — ${new Date(date).toLocaleDateString()}`}
                {activeReport === 'cash' && `Daily Cash Position Audit — ${new Date(date).toLocaleDateString()}`}
                {activeReport === 'debtors' && 'Outstanding Debtors Ledger'}
                {activeReport === 'creditors' && 'Outstanding Creditors Ledger'}
                {activeReport === 'closing' && `End-of-Day Sign-off Report — ${new Date(date).toLocaleDateString()}`}
                {activeReport === 'ledger' && `Stock Ledger movements — ${products.find(p => p.id === Number(selectedProductId))?.productName}`}
              </h2>
              <p className="text-xs text-slate-500 print:text-slate-600 mt-1">
                Generated: {new Date().toLocaleString()} | Operating Currency: USD
              </p>
            </div>

            {/* Content Sections */}
            {activeReport === 'products' && (
              <table className="table w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700 print:border-black">
                    <th className="p-2 text-left">Item #</th>
                    <th className="p-2 text-left">Product Name</th>
                    <th className="p-2 text-right">Cost (RMB)</th>
                    <th className="p-2 text-right">Cost (USD)</th>
                    <th className="p-2 text-right">Selling (RMB)</th>
                    <th className="p-2 text-right">Selling (USD)</th>
                    <th className="p-2 text-right">Opening Stock</th>
                    <th className="p-2 text-right">Stock On Hand</th>
                  </tr>
                </thead>
                <tbody>
                  {(Array.isArray(reportData) ? reportData : []).map((p: any) => (
                    <tr key={p.id} className="border-b border-slate-800 print:border-slate-300">
                      <td className="p-2 font-mono">{p.itemNumber}</td>
                      <td className="p-2">{p.productName}</td>
                      <td className="p-2 text-right font-mono">{p.unitCostRmb}</td>
                      <td className="p-2 text-right font-mono">{formatCurrency(p.unitCostUsd)}</td>
                      <td className="p-2 text-right font-mono">{p.sellingPriceRmb}</td>
                      <td className="p-2 text-right font-mono">{formatCurrency(p.sellingPriceUsd)}</td>
                      <td className="p-2 text-right font-mono">{p.openingQuantity}</td>
                      <td className="p-2 text-right font-mono font-bold">{p.currentQuantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {activeReport === 'sales' && (
              <table className="table w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700 print:border-black">
                    <th className="p-2 text-left">Time</th>
                    <th className="p-2 text-left">Customer</th>
                    <th className="p-2 text-left">Details</th>
                    <th className="p-2 text-center">Type</th>
                    <th className="p-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(Array.isArray(reportData) ? reportData : []).map((s: any) => (
                    <tr key={s.id} className="border-b border-slate-800 print:border-slate-300">
                      <td className="p-2 text-slate-400 print:text-black">{new Date(s.saleDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                      <td className="p-2 font-medium">{s.customerName || 'Walk-in'}</td>
                      <td className="p-2 text-xs">
                        {s.items?.map((i: any) => (
                          <div key={i.id}>• {i.product?.productName} x{i.quantity} ({formatCurrency(i.unitPrice)})</div>
                        ))}
                      </td>
                      <td className="p-2 text-center text-xs font-bold">{s.paymentType}</td>
                      <td className="p-2 text-right font-bold font-mono">{formatCurrency(s.totalAmount)}</td>
                    </tr>
                  ))}
                  {(!Array.isArray(reportData) || !reportData.length) && (
                    <tr>
                      <td colSpan={5} className="p-4 text-center text-slate-500">No sales transactions logged.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}

            {activeReport === 'expenses' && (
              <table className="table w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700 print:border-black">
                    <th className="p-2 text-left">Category</th>
                    <th className="p-2 text-left">Description</th>
                    <th className="p-2 text-left">Paid To</th>
                    <th className="p-2 text-center">Method</th>
                    <th className="p-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(Array.isArray(reportData) ? reportData : []).map((e: any) => (
                    <tr key={e.id} className="border-b border-slate-800 print:border-slate-300">
                      <td className="p-2 font-bold">{e.category}</td>
                      <td className="p-2">{e.description}</td>
                      <td className="p-2 text-slate-400 print:text-black">{e.paidTo || 'N/A'}</td>
                      <td className="p-2 text-center text-xs font-mono">{e.paymentMethod}</td>
                      <td className="p-2 text-right font-mono font-bold text-rose-500 print:text-black">{formatCurrency(e.amount)}</td>
                    </tr>
                  ))}
                  {(!Array.isArray(reportData) || !reportData.length) && (
                    <tr>
                      <td colSpan={5} className="p-4 text-center text-slate-500">No expenses logged.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}

            {activeReport === 'cash' && (
              <div className="max-w-md mx-auto space-y-4">
                <div className="flex justify-between border-b border-slate-700 print:border-black py-2">
                  <span>Opening Cash Balance:</span>
                  <span className="font-mono font-bold">{formatCurrency(reportData.openingCash)}</span>
                </div>
                <div className="flex justify-between border-b border-slate-700 print:border-black py-2 text-emerald-400 print:text-black">
                  <span>(+) Cash Sales:</span>
                  <span className="font-mono font-bold">+{formatCurrency(reportData.cashSales)}</span>
                </div>
                <div className="flex justify-between border-b border-slate-700 print:border-black py-2 text-emerald-400 print:text-black">
                  <span>(+) Debtor Payments:</span>
                  <span className="font-mono font-bold">+{formatCurrency(reportData.debtorPaymentsReceived)}</span>
                </div>
                <div className="flex justify-between border-b border-slate-700 print:border-black py-2 text-emerald-400 print:text-black">
                  <span>(+) Other Cash In:</span>
                  <span className="font-mono font-bold">+{formatCurrency(reportData.otherCashIn)}</span>
                </div>
                <div className="flex justify-between border-b border-slate-700 print:border-black py-2 text-rose-400 print:text-black">
                  <span>(-) Expenses Paid:</span>
                  <span className="font-mono font-bold">-{formatCurrency(reportData.expensesPaid)}</span>
                </div>
                <div className="flex justify-between border-b border-slate-700 print:border-black py-2 text-rose-400 print:text-black">
                  <span>(-) Creditor Payments:</span>
                  <span className="font-mono font-bold">-{formatCurrency(reportData.creditorPaymentsMade)}</span>
                </div>
                <div className="flex justify-between border-b-2 border-slate-700 print:border-black py-3 text-lg font-bold">
                  <span>Expected Closing Cash:</span>
                  <span className="font-mono">{formatCurrency(reportData.expectedClosingCash)}</span>
                </div>
                <div className="flex justify-between border-b border-slate-700 print:border-black py-2">
                  <span>Actual Counted Cash:</span>
                  <span className="font-mono font-bold">{formatCurrency(reportData.actualCountedCash)}</span>
                </div>
                <div className="flex justify-between py-2 text-lg font-bold">
                  <span>Variance:</span>
                  <span className={`font-mono ${reportData.variance < 0 ? 'text-rose-500' : 'text-green-500'} print:text-black`}>
                    {formatCurrency(reportData.variance)}
                  </span>
                </div>
              </div>
            )}

            {activeReport === 'debtors' && (
              <table className="table w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700 print:border-black">
                    <th className="p-2 text-left">Customer Name</th>
                    <th className="p-2 text-left">Phone</th>
                    <th className="p-2 text-right">Owed Balance (USD)</th>
                    <th className="p-2 text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(Array.isArray(reportData) ? reportData : []).map((d: any) => (
                    <tr key={d.id} className="border-b border-slate-800 print:border-slate-300">
                      <td className="p-2 font-bold">{d.customerName}</td>
                      <td className="p-2 text-slate-400 print:text-black">{d.customerPhone || 'N/A'}</td>
                      <td className="p-2 text-right font-mono font-bold text-amber-500 print:text-black">{formatCurrency(d.outstandingBalance)}</td>
                      <td className="p-2 text-center text-xs font-mono">{d.status}</td>
                    </tr>
                  ))}
                  {(!Array.isArray(reportData) || !reportData.length) && (
                    <tr>
                      <td colSpan={4} className="p-4 text-center text-slate-500">No debtor accounts.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}

            {activeReport === 'creditors' && (
              <table className="table w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700 print:border-black">
                    <th className="p-2 text-left">Supplier Name</th>
                    <th className="p-2 text-left">Phone</th>
                    <th className="p-2 text-left">Description</th>
                    <th className="p-2 text-right">Balance Owed (USD)</th>
                    <th className="p-2 text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(Array.isArray(reportData) ? reportData : []).map((c: any) => (
                    <tr key={c.id} className="border-b border-slate-800 print:border-slate-300">
                      <td className="p-2 font-bold">{c.creditorName}</td>
                      <td className="p-2 text-slate-400 print:text-black">{c.phoneNumber || 'N/A'}</td>
                      <td className="p-2 text-slate-400 print:text-black">{c.description || 'N/A'}</td>
                      <td className="p-2 text-right font-mono font-bold text-rose-500 print:text-black">{formatCurrency(c.outstandingBalance)}</td>
                      <td className="p-2 text-center text-xs font-mono">{c.status}</td>
                    </tr>
                  ))}
                  {(!Array.isArray(reportData) || !reportData.length) && (
                    <tr>
                      <td colSpan={5} className="p-4 text-center text-slate-500">No creditors logged.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}

            {activeReport === 'closing' && (
              <div className="max-w-md mx-auto space-y-6">
                <div className="p-4 bg-slate-800/40 print:bg-white rounded-lg border border-slate-700 print:border-black space-y-3">
                  <div className="flex justify-between border-b border-slate-700 print:border-black pb-2 text-sm">
                    <span>EOD Closing Status:</span>
                    <span className="font-bold">{reportData.status || 'DRAFT'}</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-700 print:border-black pb-2 text-sm">
                    <span>Manager Sign-off Name:</span>
                    <span className="font-bold">{reportData.signOffName || 'Pending'}</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-700 print:border-black pb-2 text-sm">
                    <span>Expected Closing Cash:</span>
                    <span className="font-mono font-bold">{formatCurrency(reportData.expectedClosingCash)}</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-700 print:border-black pb-2 text-sm">
                    <span>Counted Count:</span>
                    <span className="font-mono font-bold">{formatCurrency(reportData.actualCountedCash)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Cash Variance:</span>
                    <span className="font-mono font-bold">{formatCurrency(reportData.cashVariance)}</span>
                  </div>
                </div>

                <div className="text-sm">
                  <h4 className="font-bold mb-1">Stock Verification Notes:</h4>
                  <p className="p-3 bg-slate-800/20 print:bg-slate-100 rounded text-slate-300 print:text-black font-mono whitespace-pre-wrap">
                    {reportData.stockNotes || 'No stock notes logged.'}
                  </p>
                </div>

                <div className="text-sm">
                  <h4 className="font-bold mb-1">General Closing Remarks:</h4>
                  <p className="p-3 bg-slate-800/20 print:bg-slate-100 rounded text-slate-300 print:text-black font-mono whitespace-pre-wrap">
                    {reportData.closingNotes || 'No closing remarks logged.'}
                  </p>
                </div>
              </div>
            )}

            {activeReport === 'ledger' && (
              <table className="table w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700 print:border-black">
                    <th className="p-2 text-left">Date</th>
                    <th className="p-2 text-left">Type</th>
                    <th className="p-2 text-right">Adjustment Qty</th>
                    <th className="p-2 text-right">New Balance</th>
                    <th className="p-2 text-left">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {(Array.isArray(reportData) ? reportData : []).map((m: any) => (
                    <tr key={m.id} className="border-b border-slate-800 print:border-slate-300">
                      <td className="p-2 text-slate-400 print:text-black">{new Date(m.movementDate).toLocaleString()}</td>
                      <td className="p-2 uppercase text-xs font-mono">{m.movementType}</td>
                      <td className={`p-2 text-right font-mono font-bold ${m.quantity > 0 ? 'text-emerald-500' : 'text-rose-500'} print:text-black`}>
                        {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                      </td>
                      <td className="p-2 text-right font-mono font-bold">{m.closingBalance}</td>
                      <td className="p-2 text-slate-400 print:text-black text-xs">{m.notes}</td>
                    </tr>
                  ))}
                  {(!Array.isArray(reportData) || !reportData.length) && (
                    <tr>
                      <td colSpan={5} className="p-4 text-center text-slate-500">No stock movements registered.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}

          </div>
        )}
      </div>
    </div>
  );
}
