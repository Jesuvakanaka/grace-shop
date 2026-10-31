'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke={active ? '#059669' : '#94a3b8'} strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  );
}

function StockIcon({ active }: { active: boolean }) {
  return (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke={active ? '#059669' : '#94a3b8'} strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  );
}

function MoneyIcon({ active }: { active: boolean }) {
  return (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke={active ? '#059669' : '#94a3b8'} strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function MoreIcon({ active }: { active: boolean }) {
  return (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke={active ? '#059669' : '#94a3b8'} strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" />
    </svg>
  );
}

const MONEY_PATHS = ['/cash', '/debtors', '/creditors', '/expenses'];
const STOCK_PATHS = ['/products', '/stock-ledger'];
const MORE_PATHS = ['/closing', '/reports', '/import', '/import/history', '/sales', '/settings/exchange-rate', '/daily-log'];

interface BottomNavProps {
  onActionClick: () => void;
  onMoreClick: () => void;
}

export function BottomNav({ onActionClick, onMoreClick }: BottomNavProps) {
  const pathname = usePathname();

  const isHome = pathname === '/';
  const isStock = STOCK_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
  const isMoney = MONEY_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
  const isMore = MORE_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));

  const tabClass = (active: boolean) =>
    `flex flex-col items-center justify-center gap-0.5 min-w-[56px] min-h-[44px] text-[10px] font-medium ${
      active ? 'text-emerald-600' : 'text-slate-400'
    }`;

  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 z-40 no-print bg-white border-t border-slate-200 shadow-[0_-4px_12px_rgba(15,23,42,0.06)]"
      style={{ paddingBottom: 'var(--safe-bottom)' }}
      data-testid="bottom-nav"
    >
      <div className="flex items-end justify-around px-2 pt-2 pb-2 max-w-lg mx-auto">
        <Link href="/" className={tabClass(isHome)} data-testid="bottom-nav-home">
          <HomeIcon active={isHome} />
          <span>Home</span>
        </Link>

        <Link href="/products" className={tabClass(isStock)} data-testid="bottom-nav-stock">
          <StockIcon active={isStock} />
          <span>Stock</span>
        </Link>

        <button
          type="button"
          onClick={onActionClick}
          className="flex flex-col items-center -mt-5"
          data-testid="bottom-nav-action"
          aria-label="Quick actions"
        >
          <span className="flex items-center justify-center w-14 h-14 rounded-full bg-emerald-600 text-white shadow-lg shadow-emerald-600/30">
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </span>
        </button>

        <Link href="/cash" className={tabClass(isMoney)} data-testid="bottom-nav-money">
          <MoneyIcon active={isMoney} />
          <span>Money</span>
        </Link>

        <button type="button" onClick={onMoreClick} className={tabClass(isMore)} data-testid="bottom-nav-more">
          <MoreIcon active={isMore} />
          <span>More</span>
        </button>
      </div>
    </nav>
  );
}
