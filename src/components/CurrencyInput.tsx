'use client';

import React from 'react';

interface CurrencyInputProps {
  value: number;
  onChange: (value: number) => void;
  currency?: 'USD' | 'RMB';
  placeholder?: string;
  disabled?: boolean;
}

export function CurrencyInput({ value, onChange, currency = 'USD', placeholder = '0.00', disabled = false }: CurrencyInputProps) {
  const symbol = currency === 'USD' ? '$' : '¥';

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val)) {
      onChange(val);
    } else if (e.target.value === '') {
      onChange(0);
    }
  };

  return (
    <div className="relative w-full">
      <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-400">
        {symbol}
      </div>
      <input
        type="number"
        step="0.01"
        value={value === 0 ? '' : value}
        onChange={handleChange}
        disabled={disabled}
        placeholder={placeholder}
        className={`bg-slate-900 border border-slate-700 text-slate-100 text-sm rounded-lg focus:ring-emerald-500 focus:border-emerald-500 block w-full pl-8 p-2.5 placeholder-slate-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
      />
    </div>
  );
}
