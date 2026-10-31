'use client';

import React from 'react';

interface SummaryCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: 'up' | 'down' | 'neutral';
  icon?: string;
  variant?: 'default' | 'success' | 'warning' | 'danger';
}

export function SummaryCard({ title, value, subtitle, trend, icon, variant = 'default' }: SummaryCardProps) {
  const getVariantStyles = () => {
    switch (variant) {
      case 'success': return 'text-brand-olive';
      case 'warning': return 'text-amber-700';
      case 'danger': return 'text-rose-700';
      default: return 'text-slate-900';
    }
  };

  return (
    <div className="bg-white border rounded-xl p-5 shadow-sm hover:-translate-y-1 hover:shadow-md transition-all duration-300">
      <div className="flex justify-between items-start mb-2">
        <h3 className="text-slate-400 text-sm font-medium">{title}</h3>
        {icon && <span className="text-slate-500 text-lg">{icon}</span>}
      </div>
      <div className="flex items-baseline gap-2">
        <div className={`text-2xl font-bold tracking-tight ${getVariantStyles()}`}>
          {value}
        </div>
        {trend && (
          <span className={`text-xs flex items-center font-medium ${
            trend === 'up' ? 'text-brand-olive' : 
            trend === 'down' ? 'text-rose-700' : 
            'text-slate-500'
          }`}>
            {trend === 'up' && '↑'}
            {trend === 'down' && '↓'}
            {trend === 'neutral' && '→'}
          </span>
        )}
      </div>
      {subtitle && <p className="text-xs text-slate-500 mt-2">{subtitle}</p>}
    </div>
  );
}
