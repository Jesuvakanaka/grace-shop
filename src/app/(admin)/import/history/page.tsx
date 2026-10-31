'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ImportHistoryPage() {
  const router = useRouter();
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/import/history')
      .then(res => res.json())
      .then(data => {
        setHistory(data || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6 text-center">Loading import history...</div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Import History Registry</h1>
        <button 
          onClick={() => router.push('/import')} 
          className="btn btn-primary text-sm"
        >
          New File Import
        </button>
      </div>

      <div className="card p-6 table-container">
        <table className="table w-full" data-testid="import-history-table">
          <thead>
            <tr className="bg-brand-cream-100 text-slate-600">
              <th className="p-2 text-left">Date</th>
              <th className="p-2 text-left">Filename</th>
              <th className="p-2 text-left">Type</th>
              <th className="p-2 text-right">Imported</th>
              <th className="p-2 text-right">Skipped</th>
              <th className="p-2 text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h: any) => (
              <tr key={h.id} className="border-t border-slate-200 hover:bg-brand-cream-50" data-testid="import-history-row">
                <td className="p-2 text-slate-400">{new Date(h.createdAt).toLocaleString()}</td>
                <td className="p-2 text-slate-900 font-mono text-xs">{h.filename}</td>
                <td className="p-2 text-slate-700 font-bold uppercase">{h.documentType?.replace('_', ' ')}</td>
                <td className="p-2 text-right text-brand-olive font-bold">{h.importedRows}</td>
                <td className="p-2 text-right text-rose-700 font-bold">{h.skippedRows}</td>
                <td className="p-2 text-center">
                  <span className={`px-2 py-1 rounded text-xs font-bold uppercase ${
                    h.status === 'COMPLETED' ? 'bg-brand-olive-50 text-brand-olive-700' :
                    h.status === 'DRAFT' ? 'bg-amber-50 text-amber-800' : 'bg-rose-50 text-rose-700'
                  }`}>
                    {h.status}
                  </span>
                </td>
              </tr>
            ))}
            {!history.length && (
              <tr>
                <td colSpan={6} className="p-4 text-center text-slate-500">No import records found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
