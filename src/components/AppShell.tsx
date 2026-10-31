'use client';

import { useAuth } from '@/components/AuthProvider';
import { Sidebar } from '@/components/Sidebar';
import { BottomNav } from '@/components/BottomNav';
import { MoreSheet } from '@/components/MoreSheet';
import { QuickActionSheet } from '@/components/QuickActionSheet';
import { LoginPage } from '@/components/LoginPage';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { useState } from 'react';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);
  const [actionOpen, setActionOpen] = useState(false);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-brand-cream">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <div className="flex min-h-screen bg-brand-cream">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        {/* Mobile top bar */}
        <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200 no-print">
          <div className="flex items-center gap-2.5 min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element -- static brand SVG, no optimisation needed */}
            <img src="/brand/vyra-mark.svg" alt="" width={32} height={32} className="w-8 h-8 shrink-0" />
            <div className="min-w-0">
              <p className="text-[11px] font-medium tracking-[0.32em] text-slate-900 leading-tight">VYRA</p>
              <p className="text-sm font-semibold text-slate-900 truncate">{user.fullName}</p>
            </div>
          </div>
          <div className="w-9 h-9 rounded-full bg-brand-olive-100 flex items-center justify-center text-brand-olive-700 font-semibold text-sm uppercase">
            {user.username?.substring(0, 2) || 'U'}
          </div>
        </header>

        <main className="flex-1 overflow-auto lg:pb-0 pb-nav">
          {children}
        </main>

        <BottomNav
          onActionClick={() => setActionOpen(true)}
          onMoreClick={() => setMoreOpen(true)}
        />
      </div>

      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
      <QuickActionSheet open={actionOpen} onClose={() => setActionOpen(false)} />
    </div>
  );
}
