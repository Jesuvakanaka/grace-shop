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
        return 'bg-amber-500/10 text-amber-500 border-amber-500/20';
      case 'PART_PAID':
      case 'WARNING':
      case 'DRAFT':
        return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
      case 'PAID':
      case 'CLOSED':
      case 'COMPLETED':
      case 'READY':
        return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20';
      case 'FAILED':
      case 'ERROR':
        return 'bg-rose-500/10 text-rose-500 border-rose-500/20';
      case 'CANCELLED':
        return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
      default:
        return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
    }
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${getStyles()}`}>
      {status.replace('_', ' ')}
    </span>
  );
}
