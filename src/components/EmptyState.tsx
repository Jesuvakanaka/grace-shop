'use client';

import React from 'react';

interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon = '📭', title, description, action }: EmptyStateProps) {
  return (
    <div className="w-full flex flex-col items-center justify-center p-12 text-center rounded-xl border border-dashed bg-brand-cream-50">
      <div className="text-5xl mb-4 opacity-80">{icon}</div>
      <h3 className="font-serif text-2xl font-semibold text-slate-900 mb-2">{title}</h3>
      {description && <p className="text-slate-500 max-w-sm mb-6">{description}</p>}
      {action && <div>{action}</div>}
    </div>
  );
}
