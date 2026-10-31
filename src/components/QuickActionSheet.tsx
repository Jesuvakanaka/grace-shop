'use client';

import Link from 'next/link';
import { Sheet } from '@/components/ui/Sheet';

interface QuickActionSheetProps {
  open: boolean;
  onClose: () => void;
}

const actions = [
  { label: 'Record Sale', href: '/daily-log', description: 'Cash or credit sale', icon: '💰' },
  { label: 'Record Expense', href: '/daily-log?tab=expense', description: 'Log a business expense', icon: '💸' },
  { label: 'Debtor Payment', href: '/daily-log?tab=debtor', description: 'Record payment received', icon: '👥' },
  { label: 'Creditor Payment', href: '/daily-log?tab=creditor', description: 'Pay a supplier', icon: '🏢' },
];

export function QuickActionSheet({ open, onClose }: QuickActionSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title="Quick action">
      <div className="space-y-2">
        {actions.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            onClick={onClose}
            className="flex items-center gap-4 p-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 active:bg-slate-100"
          >
            <span className="flex items-center justify-center w-12 h-12 rounded-xl bg-emerald-50 text-2xl">
              {action.icon}
            </span>
            <div>
              <div className="font-semibold text-slate-900">{action.label}</div>
              <div className="text-sm text-slate-500">{action.description}</div>
            </div>
          </Link>
        ))}
      </div>
    </Sheet>
  );
}
