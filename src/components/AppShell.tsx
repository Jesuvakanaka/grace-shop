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
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        {/* Mobile top bar */}
        <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200 no-print">
          <div>
            <p className="text-xs text-slate-500">Grace Shop</p>
            <p className="text-sm font-semibold text-slate-900 truncate">{user.fullName}</p>
          </div>
          <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-semibold text-sm uppercase">
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
