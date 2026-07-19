'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { label: 'Dashboard', href: '/', icon: '📊' },
  { label: 'Daily Log', href: '/daily-log', icon: '📋' },
  { label: 'Products', href: '/products', icon: '📦' },
  { label: 'Sales', href: '/sales', icon: '💰' },
  { label: 'Expenses', href: '/expenses', icon: '💸' },
  { label: 'Cash Position', href: '/cash', icon: '🏦' },
  { label: 'Debtors', href: '/debtors', icon: '👥' },
  { label: 'Creditors', href: '/creditors', icon: '🏢' },
  { label: 'Stock Ledger', href: '/stock-ledger', icon: '📒' },
  { label: 'Day Closing', href: '/closing', icon: '🔒' },
  { label: 'Import Data', href: '/import', icon: '📥' },
  { label: 'Reports', href: '/reports', icon: '📊' },
  { label: 'Exchange Rate', href: '/settings/exchange-rate', icon: '⚙️' },
];

export function Sidebar() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {/* Mobile toggle */}
      <div className="md:hidden flex items-center justify-between p-4 bg-slate-900 border-b border-slate-700">
        <span className="font-bold text-slate-100 flex items-center gap-2">
          <span className="text-emerald-500">❖</span> Business Control
        </span>
        <button onClick={() => setIsOpen(!isOpen)} className="text-slate-400 hover:text-slate-100 focus:outline-none">
          ☰
        </button>
      </div>

      <div className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 border-r border-slate-700 flex flex-col transition-transform duration-300 ease-in-out
        ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        md:relative
      `}>
        <div className="p-6">
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <span className="text-emerald-500">❖</span> Business Control
          </h1>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== '/' && pathname?.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setIsOpen(false)}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-emerald-500/10 text-emerald-500 font-medium'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'
                }`}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-700">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-slate-300 border border-slate-700">
              U
            </div>
            <div>
              <p className="text-sm font-medium text-slate-200">Admin User</p>
              <p className="text-xs text-slate-500">admin@business.local</p>
            </div>
          </div>
          <button className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg border border-slate-700 text-slate-400 hover:text-rose-500 hover:border-rose-500/50 hover:bg-rose-500/10 transition-colors">
            <span>🚪</span> Logout
          </button>
        </div>
      </div>
      
      {/* Mobile overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-slate-950/50 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}
    </>
  );
}
