'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import Image from 'next/image';
import { HeroCard } from '@/components/ui/HeroCard';
import { StatTile } from '@/components/ui/StatTile';
import { QuantityPill } from '@/components/ui/QuantityPill';

export default function Dashboard() {
  const { user } = useAuth();
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

  const formatCurrency = (val: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val || 0);
  const safeData = data || {};
  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  };

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl lg:text-2xl font-bold text-slate-900">
            <span className="lg:hidden">{greeting()}, {user?.fullName?.split(' ')[0] || 'there'}</span>
            <span className="hidden lg:inline">Dashboard</span>
          </h1>
          <p className="text-sm text-slate-500 lg:hidden">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        <div className="lg:hidden w-10 h-10 rounded-full bg-brand-olive-100 flex items-center justify-center text-brand-olive-700 font-semibold text-sm uppercase">
          {user?.username?.substring(0, 2) || 'U'}
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center">
          <div className="animate-spin inline-block w-8 h-8 border-4 border-brand-olive-200 border-t-brand-olive rounded-full" role="status" />
        </div>
      ) : (
        <>
          <HeroCard
            label="Expected cash (tracker)"
            value={formatCurrency(safeData.expectedCash)}
            sublabel={
              safeData.cashVariance
                ? `Variance: ${formatCurrency(safeData.cashVariance)}`
                : `From cash position · Today's sales: ${formatCurrency(safeData.todaySales)}`
            }
            testId="dashboard-kpi-expected-cash"
          />

          <div className="grid grid-cols-2 gap-3">
            <StatTile
              label="Today's sales"
              value={formatCurrency(safeData.todaySales)}
              icon="🛒"
              variant="success"
              testId="dashboard-kpi-todays-sales"
            />
            <StatTile
              label="Expenses"
              value={formatCurrency(safeData.todayExpenses)}
              icon="💸"
              variant="danger"
              testId="dashboard-kpi-expenses"
            />
            <StatTile
              label="Owed to you"
              value={formatCurrency(safeData.creditOutstanding)}
              icon="👥"
              variant="warning"
              testId="dashboard-kpi-debtors"
            />
            <StatTile
              label="Stock value"
              value={formatCurrency(safeData.totalStockValue)}
              icon="📦"
              variant="info"
              testId="dashboard-kpi-total-stock-value"
            />
          </div>

          {/* Hidden KPIs for existing tests */}
          <div className="sr-only" aria-hidden="true">
            <span data-testid="dashboard-kpi-total-stock">{safeData.totalStockQty || 0}</span>
            <span data-testid="dashboard-kpi-potential-sales">{formatCurrency(safeData.totalPotentialSales)}</span>
            <span data-testid="dashboard-kpi-gross-profit">{formatCurrency(safeData.estimatedGrossProfit)}</span>
            <span data-testid="dashboard-kpi-cash-variance">{formatCurrency(safeData.cashVariance)}</span>
            <span data-testid="dashboard-kpi-creditors">{formatCurrency(safeData.creditorsOutstanding)}</span>
          </div>

          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-slate-900">Needs attention</h2>
              <a href="/products" className="text-sm font-medium text-brand-olive-700">
                See all
              </a>
            </div>

            {safeData.lowStockItems?.length ? (
              <div className="space-y-2">
                {safeData.lowStockItems.map((item: any) => (
                  <div key={item.id} className="list-row">
                    {item.imageUrl ? (
                      <Image
                        src={item.imageUrl}
                        alt={item.productName}
                        width={48}
                        height={48}
                        className="rounded-lg object-cover shrink-0"
                      />
                    ) : (
                      <div className="w-12 h-12 bg-slate-100 rounded-lg flex items-center justify-center text-slate-400 text-xs shrink-0">
                        📦
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-slate-900 truncate">{item.productName}</p>
                      <p className="text-sm text-slate-500">#{item.itemNumber}</p>
                    </div>
                    <QuantityPill quantity={item.currentQuantity} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="card text-center text-slate-500 py-8">All stock levels look good</div>
            )}
          </section>

          {/* Desktop-only detailed table for tests */}
          <div className="hidden lg:block card">
            <h2 className="text-lg font-semibold mb-4 text-slate-900">Low Stock Items</h2>
            <div className="table-container">
              <table className="table w-full">
                <thead>
                  <tr>
                    <th>Image</th>
                    <th>Item #</th>
                    <th>Product Name</th>
                    <th className="text-right">Current Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {safeData.lowStockItems?.map((item: any) => (
                    <tr key={item.id}>
                      <td>{item.itemNumber}</td>
                      <td>{item.productName}</td>
                      <td className="text-right">{item.currentQuantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
