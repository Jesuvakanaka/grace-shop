'use client';
// ZP-508: Website -> Reviews (OWNER only). The moderation queue, pending
// first: approve, hide (with a private note), reply ("Reply from VYRA"),
// unpublish (back to the queue) or delete. A word-list match is flagged on
// the card. Plus a shop-only review link. The owner cannot write or edit a
// review: stars, comment and name come only from the customer.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/AuthProvider';
import { useToast } from '@/components/Toast';
import { ReviewLinkCreator } from '@/components/ReviewLinkCreator';
import { REVIEW_NOTE_MAX, REVIEW_REPLY_MAX, type ReviewStatus } from '@/lib/reviews/rules';
import { PENDING_REVIEWS_EVENT } from '@/components/usePendingReviews';

interface OwnerReview {
  id: number;
  status: ReviewStatus;
  stars: number;
  shopStars: number | null;
  comment: string;
  displayName: string;
  photoUrl: string | null;
  photoConsent: boolean;
  flagged: boolean;
  ownerReply: string | null;
  privateNote: string | null;
  productId: number | null;
  productName: string | null;
  createdAt: string;
}

type Filter = 'ALL' | ReviewStatus;

const STATUS_LABEL: Record<ReviewStatus, string> = { PENDING: 'Waiting for you', APPROVED: 'On the website', HIDDEN: 'Hidden' };
const STATUS_TONE: Record<ReviewStatus, string> = {
  PENDING: 'bg-amber-50 text-amber-800 border-amber-200',
  APPROVED: 'bg-brand-olive-50 text-brand-olive-700 border-brand-olive-200',
  HIDDEN: 'bg-slate-100 text-slate-600 border-slate-200',
};

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

function ReviewCard({ review, onChange }: { review: OwnerReview; onChange: () => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<'idle' | 'reply' | 'hide'>('idle');
  const [reply, setReply] = useState(review.ownerReply ?? '');
  const [note, setNote] = useState(review.privateNote ?? '');
  const [busy, setBusy] = useState(false);

  const act = async (body: Record<string, unknown>, done: string) => {
    setBusy(true);
    const r = await send(`/api/website/reviews/${review.id}`, 'PATCH', body);
    setBusy(false);
    if (!r.ok) return toast.error(r.data.error || 'Could not save');
    toast.success(done);
    setMode('idle');
    onChange();
  };

  const remove = async () => {
    if (!window.confirm(`Delete the review by ${review.displayName} for good? This cannot be undone.`)) return;
    setBusy(true);
    const r = await send(`/api/website/reviews/${review.id}`, 'DELETE');
    setBusy(false);
    if (!r.ok) return toast.error(r.data.error || 'Could not delete');
    toast.success('Review deleted');
    onChange();
  };

  return (
    <li className="card p-4 space-y-3" data-testid="review-card" data-status={review.status}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={`rounded border px-2 py-0.5 text-xs font-medium ${STATUS_TONE[review.status]}`}>{STATUS_LABEL[review.status]}</span>
        {review.flagged ? (
          <span className="rounded border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700" data-testid="review-flagged">
            ⚠ Check the wording
          </span>
        ) : null}
        <span className="text-slate-500">{review.productName ?? 'Shop review'}</span>
        <span className="ml-auto text-xs text-slate-500">{day(review.createdAt)}</span>
      </div>
      <div className="flex gap-3">
        {review.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed-in admin image route
          <img src={review.photoUrl} alt={`Photo from ${review.displayName}`} className="h-28 w-22 shrink-0 rounded object-cover" style={{ width: 88 }} />
        ) : null}
        <div className="min-w-0 space-y-1">
          <p className="text-brand-olive-700 tracking-wider" aria-label={`${review.stars} out of 5 stars`}>
            {stars(review.stars)}
            {review.productId !== null && review.shopStars !== null ? (
              <span className="ml-2 text-xs text-slate-500">Shop: {review.shopStars}/5</span>
            ) : null}
          </p>
          <p className="whitespace-pre-line break-words text-slate-900">{review.comment}</p>
          <p className="text-sm font-medium text-slate-700">{review.displayName} <span className="text-xs font-normal text-slate-500">· verified buyer</span></p>
          {review.photoUrl ? (
            <p className="text-xs text-slate-500">
              {review.photoConsent ? 'Photo: the customer agreed it may be shown.' : 'Photo: NOT for the website (no consent). Never shown publicly.'}
            </p>
          ) : null}
          {review.ownerReply && mode !== 'reply' ? (
            <p className="text-sm text-slate-600 border-l-2 border-brand-olive pl-2">Your reply: {review.ownerReply}</p>
          ) : null}
          {review.privateNote && review.status === 'HIDDEN' ? <p className="text-xs text-slate-500">Private note: {review.privateNote}</p> : null}
        </div>
      </div>

      {mode === 'reply' ? (
        <div className="space-y-2">
          <label className="label" htmlFor={`reply-${review.id}`}>Reply from VYRA (shown under the review)</label>
          <textarea id={`reply-${review.id}`} className="input w-full" rows={3} maxLength={REVIEW_REPLY_MAX} value={reply} onChange={(e) => setReply(e.target.value)} data-testid="review-reply-input" />
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn btn-secondary" onClick={() => setMode('idle')}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act({ action: 'reply', reply }, reply.trim() ? 'Reply saved' : 'Reply removed')} data-testid="review-reply-save">
              Save reply
            </button>
          </div>
        </div>
      ) : mode === 'hide' ? (
        <div className="space-y-2">
          <label className="label" htmlFor={`note-${review.id}`}>Private note (only you see it)</label>
          <input id={`note-${review.id}`} className="input w-full" maxLength={REVIEW_NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2 justify-end">
            <button type="button" className="btn btn-secondary" onClick={() => setMode('idle')}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act({ action: 'hide', note }, 'Review hidden')}>
              Hide review
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 justify-end">
          {review.status !== 'APPROVED' ? (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act({ action: 'approve' }, 'Review is on the website')} data-testid="review-approve">
              Approve
            </button>
          ) : (
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => act({ action: 'unpublish' }, 'Review taken off the website')} data-testid="review-unpublish">
              Unpublish
            </button>
          )}
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setMode('reply')} data-testid="review-reply">
            {review.ownerReply ? 'Edit reply' : 'Reply'}
          </button>
          {review.status !== 'HIDDEN' ? (
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setMode('hide')} data-testid="review-hide">
              Hide
            </button>
          ) : null}
          <button type="button" className="btn btn-secondary text-rose-700" disabled={busy} onClick={remove} data-testid="review-delete">
            Delete
          </button>
        </div>
      )}
    </li>
  );
}

export default function WebsiteReviewsPage() {
  const { isOwner, loading: authLoading } = useAuth();
  const [reviews, setReviews] = useState<OwnerReview[]>([]);
  const [pending, setPending] = useState(0);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await send(`/api/website/reviews${filter === 'ALL' ? '' : `?status=${filter}`}`, 'GET');
    if (r.ok) {
      setReviews(r.data.reviews);
      setPending(r.data.pending);
      setError(null);
      window.dispatchEvent(new CustomEvent(PENDING_REVIEWS_EVENT, { detail: r.data.pending }));
    } else setError(r.data.error || 'Could not load the reviews');
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async fetch on mount / filter change
    if (isOwner) load();
  }, [isOwner, load]);

  if (authLoading) return <div className="p-8 text-center text-slate-500">Loading...</div>;
  if (!isOwner) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-2">Website</h1>
        <p className="text-slate-600">Only the owner can manage the website.</p>
      </div>
    );
  }

  const filters: { id: Filter; label: string }[] = [
    { id: 'ALL', label: 'All' },
    { id: 'PENDING', label: `Waiting${pending ? ` (${pending})` : ''}` },
    { id: 'APPROVED', label: 'On the website' },
    { id: 'HIDDEN', label: 'Hidden' },
  ];

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      <div className="mb-1 text-sm text-slate-500">Website</div>
      <h1 className="text-2xl font-bold mb-2">Reviews</h1>
      <nav className="flex gap-4 text-sm mb-6 border-b border-slate-200" aria-label="Website tools">
        <Link href="/website/categories" className="pb-2 text-slate-600 hover:text-slate-900">Categories</Link>
        <span className="pb-2 border-b-2 border-brand-olive text-brand-olive-700 font-medium" aria-current="page">Reviews</span>
        <Link href="/website/settings" className="pb-2 text-slate-600 hover:text-slate-900">Site settings</Link>
      </nav>

      <p className="text-sm text-slate-600 mb-4">
        Only customers you send a link to can review. Nothing shows on the website until you approve it. To ask for a piece review, open the product and use
        &ldquo;Send review link&rdquo; in its Website section.
      </p>

      <div className="mb-6">
        <ReviewLinkCreator productId={null} title="Shop review link (no piece)" />
      </div>

      <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label="Show">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={`rounded-full border px-3 py-1.5 text-sm ${filter === f.id ? 'border-brand-olive bg-brand-olive-50 text-brand-olive-700 font-medium' : 'border-slate-200 text-slate-600'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error ? <p className="text-rose-700">{error}</p> : null}
      {loading ? (
        <p className="text-slate-500">Loading...</p>
      ) : reviews.length === 0 ? (
        <p className="text-slate-500" data-testid="reviews-empty">No reviews here yet.</p>
      ) : (
        <ul className="space-y-3" data-testid="reviews-list">
          {reviews.map((r) => (
            <ReviewCard key={`${r.id}-${r.status}-${r.ownerReply ?? ''}`} review={r} onChange={load} />
          ))}
        </ul>
      )}
    </div>
  );
}
