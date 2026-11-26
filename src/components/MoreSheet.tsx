'use client';

import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { pendingReviewsLabel, usePendingReviews } from '@/components/usePendingReviews';
import { Sheet } from '@/components/ui/Sheet';
import { STOREFRONT_PREFIX } from '@/lib/host-routing';
import { SITE_ROUTES, sitePath } from '@/lib/storefront/paths';

const moreItems = [
  { label: 'Daily Log', href: '/daily-log', icon: '📋', testId: 'more-nav-daily-log' },
  { label: 'Sales', href: '/sales', icon: '💰', testId: 'more-nav-sales' },
  { label: 'Stock Ledger', href: '/stock-ledger', icon: '📒', testId: 'more-nav-stock-ledger' },
  { label: 'Day Closing', href: '/closing', icon: '🔒', testId: 'more-nav-closing' },
  { label: 'Reports', href: '/reports', icon: '📊', testId: 'more-nav-reports' },
  { label: 'Add with AI', href: '/capture', icon: '📸', testId: 'more-nav-capture', ownerOnly: true },
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
        {/* Back to the public VYRA website (served under /site on the admin host). */}
        <a
          href={sitePath(STOREFRONT_PREFIX, SITE_ROUTES.home)}
          target="_blank"
          rel="noopener"
          onClick={onClose}
          className="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-700 hover:bg-slate-50 active:bg-slate-100"
          data-testid="more-nav-view-website"
        >
          <span className="text-xl">🛍️</span>
          <span className="font-medium">View website</span>
          <span className="ml-auto text-sm text-slate-400" aria-hidden="true">↗</span>
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
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
