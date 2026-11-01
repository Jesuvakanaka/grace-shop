'use client';

import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { pendingReviewsLabel, usePendingReviews } from '@/components/usePendingReviews';
import { Sheet } from '@/components/ui/Sheet';

const moreItems = [
  { label: 'Daily Log', href: '/daily-log', icon: '📋', testId: 'more-nav-daily-log' },
  { label: 'Sales', href: '/sales', icon: '💰', testId: 'more-nav-sales' },
  { label: 'Stock Ledger', href: '/stock-ledger', icon: '📒', testId: 'more-nav-stock-ledger' },
  { label: 'Day Closing', href: '/closing', icon: '🔒', testId: 'more-nav-closing' },
  { label: 'Reports', href: '/reports', icon: '📊', testId: 'more-nav-reports' },
  { label: 'Website', href: '/website', icon: '🌐', testId: 'more-nav-website', ownerOnly: true },
  { label: 'Insights', href: '/insights', icon: '📈', testId: 'more-nav-insights', ownerOnly: true },
  { label: 'Import Data', href: '/import', icon: '📥', testId: 'more-nav-import', ownerOnly: true },
  { label: 'Exchange Rate', href: '/settings/exchange-rate', icon: '⚙️', testId: 'more-nav-exchange-rate', ownerOnly: true },
  { label: 'Change Password', href: '/settings/password', icon: '🔑', testId: 'more-nav-change-password' },
];

interface MoreSheetProps {
  open: boolean;
  onClose: () => void;
}

export function MoreSheet({ open, onClose }: MoreSheetProps) {
  const { user } = useAuth();
  const visible = moreItems.filter((item) => !(item.ownerOnly && user?.role !== 'OWNER'));
  // ZP-508: reviews waiting for the owner, as a badge on "Website".
  const pendingReviews = usePendingReviews();

  return (
    <Sheet open={open} onClose={onClose} title="More">
      <div className="space-y-1">
        {visible.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={onClose}
            className="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-700 hover:bg-slate-50 active:bg-slate-100"
            data-testid={item.testId}
          >
            <span className="text-xl">{item.icon}</span>
            <span className="font-medium">{item.label}</span>
            {item.href === '/website' && pendingReviews > 0 ? (
              <span className="ml-auto rounded-full bg-amber-500 px-2 py-0.5 text-xs font-semibold text-white" data-testid="more-reviews-badge">
                {pendingReviews}
                <span className="sr-only"> {pendingReviewsLabel(pendingReviews)}</span>
              </span>
            ) : null}
          </Link>
        ))}
      </div>
    </Sheet>
  );
}
