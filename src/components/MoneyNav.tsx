'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const segments = [
  { label: 'Cash', href: '/cash' },
  { label: 'Debtors', href: '/debtors' },
  { label: 'Creditors', href: '/creditors' },
  { label: 'Expenses', href: '/expenses' },
];

export function MoneyNav() {
  const pathname = usePathname();

  return (
    <div
      className="flex gap-1 p-1 bg-slate-100 rounded-xl overflow-x-auto no-print mb-4"
      data-testid="money-nav"
    >
      {segments.map((seg) => {
        const active = pathname === seg.href;
        return (
          <Link
            key={seg.href}
            href={seg.href}
            className={`flex-1 min-w-[72px] text-center py-2 px-3 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
              active
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
            data-testid={`money-nav-${seg.href.slice(1)}`}
          >
            {seg.label}
          </Link>
        );
      })}
    </div>
  );
}
