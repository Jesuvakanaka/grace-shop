'use client';
// ZP-1200: is the Marketing hub switched on? Owner only. GET /api/marketing/status answers 404 when
// GRACE_MARKETING_HUB is "false", so the nav item stays hidden until the answer is OK.
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';

export function useMarketingEnabled(): boolean {
  const { isOwner } = useAuth();
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    fetch('/api/marketing/status')
      .then((r) => {
        if (!cancelled) setEnabled(r.ok);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isOwner]);

  return isOwner && enabled;
}
