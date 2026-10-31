'use client';

import React from 'react';

interface PrintLayoutProps {
  title: string;
  children: React.ReactNode;
  date?: string;
}

export function PrintLayout({ title, children, date = new Date().toLocaleDateString() }: PrintLayoutProps) {
  return (
    <>
      <div className="hidden print:block text-black bg-white min-h-screen">
        <div className="mb-8 border-b border-gray-300 pb-4">
          <h1 className="text-2xl font-bold">{title}</h1>
          <div className="flex justify-between text-sm text-gray-600 mt-2">
            <span>VYRA · Stock, Cash &amp; Credit</span>
            <span>Date: {date}</span>
          </div>
        </div>
        <div className="print-content">
          {children}
        </div>
      </div>
      <div className="print:hidden">
        {children}
      </div>
    </>
  );
}
