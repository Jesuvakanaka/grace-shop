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
      <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-500">
        {symbol}
      </div>
      <input
        type="number"
        step="0.01"
        value={value === 0 ? '' : value}
        onChange={handleChange}
        disabled={disabled}
        placeholder={placeholder}
        className={`bg-white border text-slate-900 text-base rounded-lg focus:outline-none focus:ring-4 focus:ring-brand-lime/40 focus:border-brand-olive block w-full pl-8 p-2.5 placeholder-slate-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
      />
    </div>
  );
}
