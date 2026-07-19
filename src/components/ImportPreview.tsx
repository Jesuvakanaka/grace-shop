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
      <div className="flex gap-4 p-4 bg-slate-800 rounded-lg border border-slate-700">
        <div className="flex flex-col">
          <span className="text-slate-500 text-sm">Total</span>
          <span className="text-slate-200 font-medium">{totalRows}</span>
        </div>
        <div className="flex flex-col border-l border-slate-700 pl-4">
          <span className="text-slate-500 text-sm">Ready</span>
          <span className="text-emerald-500 font-medium">{readyRows}</span>
        </div>
        <div className="flex flex-col border-l border-slate-700 pl-4">
          <span className="text-slate-500 text-sm">Warnings</span>
          <span className="text-amber-500 font-medium">{warningRows}</span>
        </div>
        <div className="flex flex-col border-l border-slate-700 pl-4">
          <span className="text-slate-500 text-sm">Errors</span>
          <span className="text-rose-500 font-medium">{errorRows}</span>
        </div>
      </div>

      <div className="border border-slate-700 rounded-lg overflow-hidden bg-slate-800/50">
        <div className="overflow-x-auto max-h-[400px]">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-800 text-slate-300 sticky top-0 z-10">
              <tr>
                <th className="px-4 py-3 font-medium w-16">Row</th>
                <th className="px-4 py-3 font-medium w-24">Status</th>
                {columnKeys.map(key => (
                  <th key={key} className="px-4 py-3 font-medium">{key}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {rows.map((row) => (
                <React.Fragment key={row.rowNumber}>
                  <tr 
                    className={`hover:bg-slate-700/50 transition-colors ${row.errors.length > 0 ? 'cursor-pointer' : ''}`}
                    onClick={() => row.errors.length > 0 && toggleRow(row.rowNumber)}
                  >
                    <td className="px-4 py-3 text-slate-500">{row.rowNumber}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={row.status} />
                    </td>
                    {columnKeys.map(key => (
                      <td key={key} className="px-4 py-3 text-slate-300 whitespace-nowrap">
                        {String(row.data[key] ?? '')}
                      </td>
                    ))}
                  </tr>
                  {expandedRows.has(row.rowNumber) && row.errors.length > 0 && (
                    <tr className="bg-rose-500/5 border-t-0">
                      <td colSpan={columnKeys.length + 2} className="px-4 py-3">
                        <div className="text-rose-400 text-xs space-y-1">
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
          className="px-4 py-2 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button 
          onClick={onConfirm}
          disabled={loading || readyRows === 0 || errorRows > 0}
          className="px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {loading && <span className="animate-spin inline-block w-4 h-4 border-2 border-white/20 border-t-white rounded-full"></span>}
          Confirm Import
        </button>
      </div>
    </div>
  );
}
