'use client';

import React, { useState } from 'react';
import { StatusBadge, StatusType } from './StatusBadge';

export interface ImportPreviewRow {
  rowNumber: number;
  data: Record<string, any>;
  status: StatusType;
  errors: string[];
}

interface ImportPreviewProps {
  rows: ImportPreviewRow[];
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export function ImportPreview({ rows, onConfirm, onCancel, loading = false }: ImportPreviewProps) {
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  const toggleRow = (rowNumber: number) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(rowNumber)) {
      newExpanded.delete(rowNumber);
    } else {
      newExpanded.add(rowNumber);
    }
    setExpandedRows(newExpanded);
  };

  const totalRows = rows.length;
  const readyRows = rows.filter(r => r.status === 'READY').length;
  const errorRows = rows.filter(r => r.status === 'ERROR').length;
  const warningRows = rows.filter(r => r.status === 'WARNING').length;

  const columnKeys = rows.length > 0 ? Object.keys(rows[0].data) : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-4 p-4 bg-brand-cream-100 rounded-lg border">
        <div className="flex flex-col">
          <span className="text-slate-500 text-sm">Total</span>
          <span className="text-slate-900 font-medium" data-testid="import-total-rows">{totalRows}</span>
        </div>
        <div className="flex flex-col border-l pl-4">
          <span className="text-slate-500 text-sm">Ready</span>
          <span className="text-brand-olive-700 font-medium" data-testid="import-ready-rows">{readyRows}</span>
        </div>
        <div className="flex flex-col border-l pl-4">
          <span className="text-slate-500 text-sm">Warnings</span>
          <span className="text-amber-700 font-medium" data-testid="import-warning-rows">{warningRows}</span>
        </div>
        <div className="flex flex-col border-l pl-4">
          <span className="text-slate-500 text-sm">Errors</span>
          <span className="text-rose-700 font-medium" data-testid="import-error-rows">{errorRows}</span>
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden bg-white">
        <div className="overflow-x-auto max-h-[400px]">
          <table className="w-full text-left text-sm" data-testid="import-preview-table">
            <thead className="bg-brand-cream-100 text-xs uppercase tracking-[0.08em] text-slate-600 sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 font-medium w-16">Row</th>
                <th className="px-4 py-3 font-medium w-24">Status</th>
                {columnKeys.map(key => (
                  <th key={key} className="px-4 py-3 font-medium">{key}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows.map((row) => (
                <React.Fragment key={row.rowNumber}>
                  <tr 
                    className={`hover:bg-brand-cream-50 transition-colors ${row.errors.length > 0 ? 'cursor-pointer' : ''}`}
                    onClick={() => row.errors.length > 0 && toggleRow(row.rowNumber)}
                    data-testid="import-preview-row"
                    data-row-number={row.rowNumber}
                  >
                    <td className="px-4 py-3 text-slate-500">{row.rowNumber}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={row.status} />
                    </td>
                    {columnKeys.map(key => (
                      <td key={key} className="px-4 py-3 text-slate-900 whitespace-nowrap">
                        {String(row.data[key] ?? '')}
                      </td>
                    ))}
                  </tr>
                  {expandedRows.has(row.rowNumber) && row.errors.length > 0 && (
                    <tr className="bg-rose-50 border-t-0">
                      <td colSpan={columnKeys.length + 2} className="px-4 py-3">
                        <div className="text-rose-700 text-xs space-y-1">
                          {row.errors.map((err, i) => (
                            <p key={i}>• {err}</p>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-end gap-3 mt-4">
        <button 
          onClick={onCancel}
          disabled={loading}
          className="px-4 py-2 rounded-lg border bg-white text-sm font-medium uppercase tracking-[0.12em] text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button 
          onClick={onConfirm}
          disabled={loading || (readyRows === 0 && warningRows === 0)}
          className="px-4 py-2 rounded-lg bg-brand-olive text-sm font-medium uppercase tracking-[0.12em] text-white hover:bg-brand-olive-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          data-testid="import-confirm-button"
        >
          {loading && <span className="animate-spin inline-block w-4 h-4 border-2 border-white/20 border-t-white rounded-full"></span>}
          Confirm Import
        </button>
      </div>
    </div>
  );
}
