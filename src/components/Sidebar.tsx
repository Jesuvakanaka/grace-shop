'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { pendingReviewsLabel, usePendingReviews } from '@/components/usePendingReviews';

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
  // ZP-483: the VYRA website tools (Categories, with a link to Site settings from ZP-486).
  { label: 'Website', href: '/website', icon: '🌐', testId: 'sidebar-website', ownerOnly: true },
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
  // ZP-508: reviews waiting for the owner, as a badge on "Website".
  const pendingReviews = usePendingReviews();

  return (
    <aside className="hidden lg:flex w-64 shrink-0 bg-white border-r border-slate-200 flex-col h-screen sticky top-0 no-print">
      <div className="px-6 py-5 border-b border-slate-100 flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand SVG, no optimisation needed */}
        <img src="/brand/vyra-mark.svg" alt="" width={40} height={40} className="w-10 h-10 shrink-0" />
        <div className="min-w-0">
          <h1 className="font-sans text-xl font-medium tracking-[0.38em] text-slate-900 leading-none">VYRA</h1>
          <p className="mt-1.5 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">Stock, Cash &amp; Credit</p>
        </div>
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
                  ? 'bg-brand-olive-50 text-brand-olive-700 font-medium shadow-[inset_3px_0_0_var(--color-brand-lime)]'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
              data-testid={item.testId}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
              {item.href === '/website' && pendingReviews > 0 ? (
                <span className="ml-auto rounded-full bg-amber-500 px-2 py-0.5 text-xs font-semibold text-white" data-testid="nav-reviews-badge">
                  {pendingReviews}
                  <span className="sr-only"> {pendingReviewsLabel(pendingReviews)}</span>
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-100">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-full bg-brand-olive-100 flex items-center justify-center text-brand-olive-700 border border-brand-olive-200 font-semibold uppercase text-sm">
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
