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
      case 'success': return 'text-emerald-500';
      case 'warning': return 'text-amber-500';
      case 'danger': return 'text-rose-500';
      default: return 'text-slate-100';
    }
  };

  return (
    <div className="bg-slate-800/80 backdrop-blur-sm border border-slate-700/80 rounded-xl p-5 shadow-sm hover:-translate-y-1 hover:shadow-md transition-all duration-300">
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
            trend === 'up' ? 'text-emerald-500' : 
            trend === 'down' ? 'text-rose-500' : 
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
