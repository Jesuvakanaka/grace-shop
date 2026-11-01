'use client';
// ZP-508: the number of reviews waiting for the owner, for the badge on the
// admin nav's "Website" item. Owner only (the API is OWNER_ONLY; staff never
// call it). Refreshed on navigation and when the Reviews page changes it.
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';

/** The Reviews page dispatches this (detail = the new pending count) after every change. */
export const PENDING_REVIEWS_EVENT = 'vyra:pending-reviews';

export function usePendingReviews(): number {
  const { isOwner } = useAuth();
  const pathname = usePathname();
  const [pending, setPending] = useState(0);

  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    fetch('/api/website/reviews/count')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data && typeof data.pending === 'number') setPending(data.pending);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isOwner, pathname]);

  useEffect(() => {
    const onChange = (e: Event) => {
      const n = (e as CustomEvent<number>).detail;
      if (typeof n === 'number') setPending(n);
    };
    window.addEventListener(PENDING_REVIEWS_EVENT, onChange);
    return () => window.removeEventListener(PENDING_REVIEWS_EVENT, onChange);
  }, []);

  return isOwner ? pending : 0;
}

/** "3 reviews waiting" for screen readers next to the badge. */
export function pendingReviewsLabel(n: number): string {
  return `${n} ${n === 1 ? 'review' : 'reviews'} waiting`;
}
