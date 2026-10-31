'use client';

import React from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  variant?: 'danger' | 'default';
}

export function ConfirmDialog({ open, title, message, onConfirm, onCancel, confirmText = 'Confirm', variant = 'default' }: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div 
        className="absolute inset-0 bg-brand-ink/50 backdrop-blur-sm"
        onClick={onCancel}
      />
      <div className="relative bg-white border rounded-xl shadow-2xl w-full max-w-md p-6 animate-in fade-in zoom-in-95 duration-200">
        <h3 className="font-serif text-2xl font-semibold text-slate-900 mb-2">{title}</h3>
        <p className="text-slate-600 mb-6">{message}</p>
        
        <div className="flex justify-end gap-3">
          <button 
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium uppercase tracking-[0.12em] text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={onConfirm}
            className={`px-4 py-2 rounded-lg text-sm font-medium uppercase tracking-[0.12em] text-white transition-colors ${
              variant === 'danger' 
                ? 'bg-rose-600 hover:bg-rose-700' 
                : 'bg-brand-olive hover:bg-brand-olive-700'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
