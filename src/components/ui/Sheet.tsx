'use client';

import { useEffect } from 'react';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

export function Sheet({ open, onClose, title, children }: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center no-print">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} aria-hidden />
      <div
        className="relative w-full max-w-lg bg-white rounded-t-2xl shadow-xl max-h-[85vh] flex flex-col"
        style={{ paddingBottom: 'var(--safe-bottom)' }}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-slate-200" />
        </div>
        {title && (
          <div className="px-5 pb-3 pt-1">
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          </div>
        )}
        <div className="overflow-y-auto px-5 pb-6 flex-1">{children}</div>
      </div>
    </div>
  );
}
