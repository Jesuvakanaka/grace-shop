'use client';
// ZP-508: "Send review link" (OWNER only). Creates a one-time review link
// for a piece (productId) or the shop (productId null), shows it once, and
// offers "Send on WhatsApp": wa.me with the ready thank-you message and NO
// number (the owner picks the customer's chat), so the site stores no phone
// number. Used in the product's Website panel and on Website -> Reviews.
import { useState } from 'react';

type Created = { url: string; whatsappHref: string; expiresAt: string };

export function ReviewLinkCreator({ productId, title }: { productId: number | null; title?: string }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);
  const testId = productId === null ? 'review-link-shop' : 'review-link-product';

  async function create() {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch('/api/website/reviews/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, ...(name.trim() ? { customerName: name.trim() } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error || 'Could not create a review link');
      else setCreated(data);
    } catch {
      setError('Could not create a review link. Check the connection.');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 p-3 space-y-2" data-testid={testId}>
      <div>
        <p className="text-sm font-medium text-slate-900">{title ?? (productId === null ? 'Shop review link' : 'Send review link')}</p>
        <p className="text-xs text-slate-500">
          For a customer who bought {productId === null ? 'from the shop' : 'this piece'}. The link works once, for 30 days. Reviews show on the site only after you approve them.
        </p>
      </div>
      {created ? (
        <div className="space-y-2">
          <label className="label" htmlFor={`${testId}-url`}>Review link (shown once)</label>
          <input id={`${testId}-url`} className="input w-full text-xs" readOnly value={created.url} onFocus={(e) => e.target.select()} data-testid={`${testId}-url`} />
          <div className="flex flex-wrap gap-2">
            <a href={created.whatsappHref} target="_blank" rel="noopener noreferrer" className="btn btn-primary" data-testid={`${testId}-whatsapp`}>
              Send on WhatsApp
            </a>
            <button type="button" className="btn btn-secondary" onClick={copy}>
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => { setCreated(null); setName(''); }}>
              New link
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Valid until {new Date(created.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}. WhatsApp opens with the message ready; choose the customer&apos;s chat.
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <div className="grow">
            <label className="label" htmlFor={`${testId}-name`}>Customer first name (optional)</label>
            <input id={`${testId}-name`} className="input w-full" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tendai" data-testid={`${testId}-name`} />
          </div>
          <button type="button" className="btn btn-secondary" onClick={create} disabled={busy} data-testid={`${testId}-create`}>
            {busy ? 'Creating...' : 'Create review link'}
          </button>
        </div>
      )}
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
    </div>
  );
}
