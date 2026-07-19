'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';

export default function Dashboard() {
  const { user, isOwner } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/dashboard')
      .then((res) => res.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-center"><div className="animate-spin inline-block w-8 h-8 border-4 rounded-full" role="status"></div></div>;

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);
  const safeData = data || {};

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold mb-4">Dashboard</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="glass-card p-4">
          <div className="text-sm text-gray-400">📦 Total Stock Qty</div>
          <div className="text-2xl font-bold">{safeData.totalStockQty || 0}</div>
        </div>
        <div className="glass-card p-4">
          <div className="text-sm text-gray-400">💰 Total Stock Value</div>
          <div className="text-2xl font-bold">{formatCurrency(safeData.totalStockValue)}</div>
        </div>
        <div className="glass-card p-4">
          <div className="text-sm text-gray-400">📈 Total Potential Sales</div>
          <div className="text-2xl font-bold">{formatCurrency(safeData.totalPotentialSales)}</div>
        </div>
        <div className="glass-card p-4">
          <div className="text-sm text-gray-400">💵 Estimated Gross Profit</div>
          <div className="text-2xl font-bold">{formatCurrency(safeData.estimatedGrossProfit)}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="glass-card p-4">
          <div className="text-sm text-gray-400">🛒 Today's Sales</div>
          <div className="text-2xl font-bold">{formatCurrency(safeData.todaySales)}</div>
        </div>
        <div className="glass-card p-4">
          <div className="text-sm text-gray-400">💸 Today's Expenses</div>
          <div className="text-2xl font-bold">{formatCurrency(safeData.todayExpenses)}</div>
        </div>
        <div className="glass-card p-4">
          <div className="text-sm text-gray-400">🏦 Expected Cash in Hand</div>
          <div className="text-2xl font-bold">{formatCurrency(safeData.expectedCash)}</div>
        </div>
        <div className={`glass-card p-4 ${(safeData.cashVariance || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
          <div className="text-sm text-gray-400">⚖️ Cash Variance</div>
          <div className="text-2xl font-bold">{formatCurrency(safeData.cashVariance)}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass-card p-4">
          <div className="text-sm text-gray-400">📝 Credit Sales Outstanding</div>
          <div className="text-2xl font-bold">{formatCurrency(safeData.creditOutstanding)}</div>
        </div>
        <div className="glass-card p-4">
          <div className="text-sm text-gray-400">🏢 Creditors Outstanding</div>
          <div className="text-2xl font-bold">{formatCurrency(safeData.creditorsOutstanding)}</div>
        </div>
        <div className="glass-card p-4">
          <div className="text-sm text-gray-400">📝 Today's Credit Sales</div>
          <div className="text-2xl font-bold">{formatCurrency(safeData.todayCreditSales)}</div>
        </div>
      </div>

      <div className="card p-4">
        <h2 className="text-xl font-bold mb-4">⚠️ Low Stock Items</h2>
        <div className="table-container">
          <table className="table w-full">
            <thead>
              <tr>
                <th className="text-left p-2">Item #</th>
                <th className="text-left p-2">Product Name</th>
                <th className="text-right p-2">Current Qty</th>
              </tr>
            </thead>
            <tbody>
              {safeData.lowStockItems?.map((item: any) => (
                <tr key={item.id} className="border-t border-gray-700">
                  <td className="p-2">{item.itemNumber}</td>
                  <td className="p-2">{item.name}</td>
                  <td className="text-right p-2 text-red-500 font-bold">{item.currentQuantity}</td>
                </tr>
              ))}
              {!safeData.lowStockItems?.length && <tr><td colSpan={3} className="p-4 text-center text-gray-400">No low stock items</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
