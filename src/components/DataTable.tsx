'use client';

import React from 'react';

export interface Column<T = any> {
  key: string;
  header: string;
  render?: (value: any, row: T) => React.ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: string;
}

export interface DataTableProps<T = any> {
  columns: Column<T>[];
  data: T[];
  emptyMessage?: string;
  onRowClick?: (row: T) => void;
}

export function DataTable<T extends Record<string, any>>({ columns, data, emptyMessage = 'No records found.', onRowClick }: DataTableProps<T>) {
  return (
    <div className="w-full overflow-x-auto rounded-lg border bg-white shadow-sm">
      <table className="w-full text-left text-sm text-slate-900">
        <thead className="bg-brand-cream-100 text-xs uppercase tracking-[0.08em] text-slate-600">
          <tr>
            {columns.map((col) => (
              <th 
                key={col.key} 
                className={`px-4 py-3 font-medium ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'}`}
                style={{ width: col.width }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-8 text-center text-slate-500">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row, i) => (
              <tr 
                key={i} 
                onClick={() => onRowClick?.(row)}
                className={`bg-white hover:bg-brand-cream-50 transition-colors ${onRowClick ? 'cursor-pointer' : ''}`}
              >
                {columns.map((col) => (
                  <td 
                    key={col.key} 
                    className={`px-4 py-3 whitespace-nowrap ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'}`}
                  >
                    {col.render ? col.render(row[col.key], row) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
