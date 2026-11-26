'use client';
// ZP-1200: the Marketing hub (OWNER only). Checks the hub is on (GET /api/marketing/status answers 404 when
// GRACE_MARKETING_HUB is "false") and shares the live status with every screen. See docs/marketing/hub.md.
import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { HubStatusContext, Loading, MarketingTabs, type HubStatusDto } from '@/components/marketing/parts';

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  const { isOwner, loading } = useAuth();
  const [status, setStatus] = useState<HubStatusDto | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'off'>('loading');

  const load = useCallback(() => {
    fetch('/api/marketing/status')
      .then(async (r) => {
        if (!r.ok) return setState('off');
        setStatus((await r.json()) as HubStatusDto);
        setState('ok');
      })
      .catch(() => setState('off'));
  }, []);

  useEffect(() => {
    if (isOwner) load();
  }, [isOwner, load]);

  if (loading) return <Loading />;
  if (!isOwner) return <EmptyState icon="🔒" title="Owner only" description="Marketing is only for the owner." />;
  if (state === 'loading') return <Loading />;
  if (state === 'off') return <EmptyState icon="📣" title="Marketing is switched off" description="The Marketing hub is turned off on this server." />;

  return (
    <HubStatusContext.Provider value={{ status, reload: load }}>
      <PageHeader title="Marketing" subtitle="Plan, approve and share your posts" />
      <MarketingTabs />
      {children}
    </HubStatusContext.Provider>
  );
}
