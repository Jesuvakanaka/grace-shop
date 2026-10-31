'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';

const navItems = [
  { label: 'Dashboard', href: '/', icon: '📊', testId: 'sidebar-dashboard' },
  { label: 'Daily Log', href: '/daily-log', icon: '📋', testId: 'sidebar-daily-log' },
  { label: 'Products', href: '/products', icon: '📦', testId: 'sidebar-products' },
  { label: 'Sales', href: '/sales', icon: '💰', testId: 'sidebar-sales' },
  { label: 'Expenses', href: '/expenses', icon: '💸', testId: 'sidebar-expenses' },
  { label: 'Cash Position', href: '/cash', icon: '🏦', testId: 'sidebar-cash' },
  { label: 'Debtors', href: '/debtors', icon: '👥', testId: 'sidebar-debtors' },
  { label: 'Creditors', href: '/creditors', icon: '🏢', testId: 'sidebar-creditors' },
  { label: 'Stock Ledger', href: '/stock-ledger', icon: '📒', testId: 'sidebar-stock-ledger' },
  { label: 'Day Closing', href: '/closing', icon: '🔒', testId: 'sidebar-closing' },
  { label: 'Import Data', href: '/import', icon: '📥', testId: 'sidebar-import', ownerOnly: true },
  { label: 'Reports', href: '/reports', icon: '📊', testId: 'sidebar-reports' },
  { label: 'Exchange Rate', href: '/settings/exchange-rate', icon: '⚙️', testId: 'sidebar-exchange-rate', ownerOnly: true },
  { label: 'Change Password', href: '/settings/password', icon: '🔑', testId: 'sidebar-change-password' },
];

interface SidebarProps {
  onNavigate?: () => void;
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const visibleNavItems = navItems.filter((item) => !(item.ownerOnly && user?.role !== 'OWNER'));

  return (
    <aside className="hidden lg:flex w-64 shrink-0 bg-white border-r border-slate-200 flex-col h-full no-print">
      <div className="p-6 border-b border-slate-100">
        <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <span className="text-emerald-600">❖</span> Grace Shop
        </h1>
      </div>

      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5">
        {visibleNavItems.map((item) => {
          const isActive =
            pathname === item.href || (item.href !== '/' && pathname?.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-sm ${
                isActive
                  ? 'bg-emerald-50 text-emerald-700 font-medium'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
              data-testid={item.testId}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-100">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 border border-emerald-200 font-semibold uppercase text-sm">
            {user?.username?.substring(0, 2) || 'U'}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900 truncate">{user?.fullName || 'User'}</p>
            <p className="text-xs text-slate-500">{user?.role || 'STAFF'}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={async () => {
            try {
              await logout();
              router.push('/');
            } catch (e) {
              console.error(e);
            }
          }}
          className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg border border-slate-200 text-slate-600 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 transition-colors cursor-pointer text-sm"
          data-testid="logout-button"
        >
          <span>🚪</span> Logout
        </button>
      </div>
    </aside>
  );
}
