'use client';
// ZP-1118 (MM-13-AC5): refunds, cancellations and corrections for one sale on the sales log.
// The server decides what is allowed (owner only, amounts, pieces); this only asks and shows the answer.
import React, { useState } from 'react';

interface Refund {
  id: number
  refundDate: string
  amount: number
  method: string
  reason: string
  quantity: number
  voidedAt: string | null
  voidedBy: string | null
  voidReason: string | null
}
interface Item { id: number; quantity: number; product?: { productName?: string } }
export interface SaleRow {
  id: number
  status?: string
  cancelReason?: string | null
  totalAmount: number
  cashAmount?: number
  creditAmount?: number
  items?: Item[]
  refunds?: Refund[]
}

const usd = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v || 0);

async function post(url: string, body: unknown): Promise<string | null> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return data.error || 'That did not work. Please try again.';
}

export default function SaleActions({ sale, onChange }: { sale: SaleRow; onChange: () => void }) {
  const [mode, setMode] = useState<'none' | 'refund' | 'cancel' | 'void'>('none');
  const [voidId, setVoidId] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const [reason, setReason] = useState('');
  const [itemId, setItemId] = useState('');
  const [pieces, setPieces] = useState('0');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => `r-${sale.id}-${Date.now()}`);
  const cancelled = sale.status === 'CANCELLED';
  const refunds = sale.refunds ?? [];

  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setError('');
    const err = await fn();
    setBusy(false);
    if (err) return setError(err);
    setMode('none');
    setAmount('');
    setReason('');
    setPieces('0');
    setItemId('');
    setKey(`r-${sale.id}-${Date.now()}`);
    onChange();
  };

  const refund = () => run(() => post(`/api/sales/${sale.id}/refunds`, {
    amount: Number(amount), method, reason,
    ...(itemId ? { saleItemId: Number(itemId), quantity: Number(pieces) || 0 } : {}),
    requestKey: key,
  }));
  const cancel = () => run(() => post(`/api/sales/${sale.id}/cancel`, { reason }));
  const correct = () => run(() => post(`/api/sale-refunds/${voidId}/void`, { reason }));

  return (
    <div className="space-y-1 text-xs" data-testid="sale-actions">
      {cancelled && (
        <p className="font-semibold text-red-700" data-testid="sale-cancelled">Cancelled{sale.cancelReason ? `: ${sale.cancelReason}` : ''}</p>
      )}
      {refunds.map((r) => (
        <p key={r.id} className={r.voidedAt ? 'text-slate-400 line-through' : 'text-amber-800'} data-testid="sale-refund">
          {r.method === 'CASH' ? 'Refunded' : 'Taken off what they owe'} {usd(r.amount)} on {new Date(r.refundDate).toLocaleDateString()}
          {r.quantity > 0 ? `, ${r.quantity} back in stock` : ''}: {r.reason}
          {r.voidedAt ? ` (corrected by ${r.voidedBy}: ${r.voidReason})` : ''}
          {!r.voidedAt && (
            <button type="button" className="ml-2 underline no-underline-hover" onClick={() => { setVoidId(r.id); setReason(''); setMode('void'); }} disabled={busy}>Correct</button>
          )}
        </p>
      ))}
      {!cancelled && mode === 'none' && (
        <div className="flex gap-3">
          <button type="button" className="underline" onClick={() => setMode('refund')} data-testid="sale-refund-open">Refund</button>
          {/* Only an unpaid credit sale can be cancelled; the server checks payments too. */}
          {(sale.cashAmount ?? 0) === 0 && (sale.creditAmount ?? 0) > 0 && (
            <button type="button" className="underline" onClick={() => setMode('cancel')} data-testid="sale-cancel-open">Cancel unpaid sale</button>
          )}
        </div>
      )}
      {mode === 'refund' && (
        <div className="space-y-2 rounded border border-slate-200 p-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1">Amount
              <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="refund-amount" />
            </label>
            <label className="flex flex-col gap-1">How
              <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="CASH">Money paid back</option>
                <option value="CREDIT">Taken off what they owe</option>
              </select>
            </label>
          </div>
          {(sale.items?.length ?? 0) > 0 && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1">Pieces back from
                <select className="input" value={itemId} onChange={(e) => setItemId(e.target.value)}>
                  <option value="">Nothing comes back</option>
                  {sale.items!.map((i) => <option key={i.id} value={i.id}>{i.product?.productName || 'Product'} (sold {i.quantity})</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">Pieces
                <input className="input" inputMode="numeric" value={pieces} onChange={(e) => setPieces(e.target.value)} disabled={!itemId} />
              </label>
            </div>
          )}
          <label className="flex flex-col gap-1">Why
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="refund-reason" />
          </label>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={refund} data-testid="refund-submit">Record refund</button>
            <button type="button" className="btn" onClick={() => setMode('none')}>Back</button>
          </div>
        </div>
      )}
      {mode === 'cancel' && (
        <div className="space-y-2 rounded border border-slate-200 p-2">
          <p>Only a sale nothing was paid for can be cancelled. Its pieces go back to stock and it counts nowhere. The record stays.</p>
          <label className="flex flex-col gap-1">Why
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="cancel-reason" />
          </label>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={cancel} data-testid="cancel-submit">Cancel the sale</button>
            <button type="button" className="btn" onClick={() => setMode('none')}>Back</button>
          </div>
        </div>
      )}
      {mode === 'void' && (
        <div className="space-y-2 rounded border border-slate-200 p-2">
          <p>Correcting a refund reverses it today (money back in the till, or owed again; pieces out of stock again). The refund stays on record, marked corrected.</p>
          <label className="flex flex-col gap-1">Why
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={correct}>Correct the refund</button>
            <button type="button" className="btn" onClick={() => setMode('none')}>Back</button>
          </div>
        </div>
      )}
      {error && <p className="text-red-700" role="alert">{error}</p>}
    </div>
  );
}
