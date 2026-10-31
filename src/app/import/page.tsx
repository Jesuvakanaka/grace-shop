'use client';

import React, { useState } from 'react';
import { FileUpload } from '@/components/FileUpload';
import { ImportPreview, ImportPreviewRow } from '@/components/ImportPreview';
import { useRouter } from 'next/navigation';

export default function ImportPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [previewRows, setPreviewRows] = useState<ImportPreviewRow[] | null>(null);
  const [draftId, setDraftId] = useState<number | null>(null);
  const [docType, setDocType] = useState<string | null>(null);
  const [rate, setRate] = useState('7.30');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleFileSelect = async (file: File) => {
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const res = await fetch('/api/import/upload', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to upload spreadsheet');
      
      setDraftId(data.importDocumentId);
      setDocType(data.documentType);
      
      // Map API rows format to ImportPreviewRow format
      const rows: ImportPreviewRow[] = data.rows.map((row: any) => ({
        rowNumber: row.rowNumber,
        data: row.data || {},
        status: row.status,
        errors: [...(row.errors || []), ...(row.warnings || [])]
      }));
      
      setPreviewRows(rows);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!draftId) return;
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/import/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          importDocumentId: draftId,
          exchangeRate: Number(rate)
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to confirm import');
      
      setSuccess(`Import completed! ${data.importedRows} rows imported successfully, ${data.skippedRows} skipped.`);
      setPreviewRows(null);
      setDraftId(null);
      setDocType(null);
      // Wait a moment and redirect to history
      setTimeout(() => {
        router.push('/import/history');
      }, 1500);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    if (draftId) {
      try {
        await fetch('/api/import/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ importDocumentId: draftId })
        });
      } catch (err) {
        console.error(err);
      }
    }
    setPreviewRows(null);
    setDraftId(null);
    setDocType(null);
    setError('');
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">Import Data</h1>
        <button 
          onClick={() => router.push('/import/history')} 
          className="btn btn-secondary text-sm"
          data-testid="sidebar-import-history"
        >
          View Upload History
        </button>
      </div>

      {error && <div className="p-4 bg-red-500/10 border border-red-500/30 text-red-500 rounded-lg text-sm mb-4">{error}</div>}
      {success && <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 text-emerald-500 rounded-lg text-sm mb-4">{success}</div>}

      <div className="card p-6">
        {!previewRows ? (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-200">Upload Shift Document</h2>
            <p className="text-sm text-slate-400">
              Select an Excel file containing a Product list, Opening stock, or Daily ledger to upload. The parser will detect fields and validate rows automatically.
            </p>
            <div data-testid="import-file-input">
              <FileUpload onFileSelect={handleFileSelect} />
            </div>
            {loading && <div className="text-center p-4 text-slate-400">Uploading and validating sheet rows...</div>}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 bg-slate-800/80 rounded-lg border border-slate-700">
              <div>
                <h3 className="font-semibold text-slate-200">Document Type Detected</h3>
                <p className="text-emerald-400 font-mono text-sm uppercase mt-1" data-testid="import-document-type">{docType?.replace('_', ' ')}</p>
              </div>
              
              {docType === 'PRODUCT_LIST' && (
                <div className="max-w-xs">
                  <label className="label text-slate-400 text-xs mb-1">RMB to USD Exchange Rate for Costs</label>
                  <input
                    type="number"
                    step="0.0001"
                    className="input w-full"
                    value={rate}
                    onChange={e => setRate(e.target.value)}
                    data-testid="exchange-rate-input"
                  />
                </div>
              )}
            </div>

            <ImportPreview 
              rows={previewRows} 
              onConfirm={handleConfirm} 
              onCancel={handleCancel} 
              loading={loading} 
            />
          </div>
        )}
      </div>
    </div>
  );
}
