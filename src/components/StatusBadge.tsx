'use client';

import React from 'react';

export type StatusType = 'OPEN' | 'PART_PAID' | 'PAID' | 'DRAFT' | 'CLOSED' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'READY' | 'WARNING' | 'ERROR' | 'PENDING';

interface StatusBadgeProps {
  status: StatusType;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const getStyles = () => {
    switch (status) {
      case 'OPEN':
      case 'PENDING':
        return 'bg-amber-50 text-amber-800 border-amber-200';
      case 'PART_PAID':
      case 'WARNING':
      case 'DRAFT':
        return 'bg-yellow-50 text-yellow-800 border-yellow-200';
      case 'PAID':
      case 'CLOSED':
      case 'COMPLETED':
      case 'READY':
        return 'bg-brand-olive-50 text-brand-olive-700 border-brand-olive-200';
      case 'FAILED':
      case 'ERROR':
        return 'bg-rose-50 text-rose-700 border-rose-200';
      case 'CANCELLED':
        return 'bg-slate-100 text-slate-600 border-slate-200';
      default:
        return 'bg-slate-100 text-slate-600 border-slate-200';
    }
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${getStyles()}`}>
      {status.replace('_', ' ')}
    </span>
  );
}
