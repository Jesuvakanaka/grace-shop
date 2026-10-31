'use client';

import React from 'react';

interface FormFieldProps {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}

export function FormField({ label, error, required, children }: FormFieldProps) {
  return (
    <div className="flex flex-col gap-1.5 mb-4 w-full">
      <label className="text-sm font-medium text-slate-700">
        {label}
        {required && <span className="text-rose-700 ml-1">*</span>}
      </label>
      {children}
      {error && <span className="text-xs text-rose-700 mt-1">{error}</span>}
    </div>
  );
}
