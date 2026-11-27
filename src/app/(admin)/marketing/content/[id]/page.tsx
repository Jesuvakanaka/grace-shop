'use client';
// ZP-1200: one content idea and its per-channel posts.
import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { ChannelPicker } from '@/components/marketing/ChannelPicker';
import { PostCard } from '@/components/marketing/PostCard';
import { canRewrite } from '@/lib/marketing/ui';
import { mk, type ChannelItem, type Content, type PickerProduct, type Post } from '@/components/marketing/api';
import { DraftReport, writeWithAi, type DraftOutcome } from '@/components/marketing/ai';
import { BriefForm, EMPTY_BRIEF, SellingProfilePanel, briefBody, briefFromContent, briefProblem, useProductSelling, type BriefValue } from '@/components/marketing/brief';
import { Card, ErrorNote, Loading, PhotoTicker } from '@/components/marketing/parts';

export default function ContentPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const [content, setContent] = useState<Content | null>(null);
  const [channels, setChannels] = useState<ChannelItem[]>([]);
  const [product, setProduct] = useState<PickerProduct | null>(null);
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [plan, setPlan] = useState<BriefValue>(EMPTY_BRIEF);
  const [photos, setPhotos] = useState<string[]>([]);
  const [addKinds, setAddKinds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [aiReport, setAiReport] = useState<DraftOutcome | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const apply = useCallback((c: Content) => {
    setContent(c);
    setTitle(c.title);
    setBrief(c.brief ?? '');
    setPlan(briefFromContent(c));
    setPhotos(c.imageKeys);
  }, []);

  useEffect(() => {
    mk<{ content: Content }>(`/api/marketing/content/${id}`)
      .then(async (d) => {
        apply(d.content);
        if (d.content.productId) {
          const p = await mk<{ products: PickerProduct[] }>(`/api/marketing/products?ids=${d.content.productId}`);
          setProduct(p.products.find((x) => x.id === d.content.productId) ?? null);
        }
      })
      .catch((e) => setError(e.message));
    mk<{ channels: ChannelItem[] }>('/api/marketing/channels').then((d) => setChannels(d.channels)).catch(() => {});
  }, [id, apply]);

  const reload = async () => apply((await mk<{ content: Content }>(`/api/marketing/content/${id}`)).content);

  const saveDetails = async () => {
    const problem = briefProblem(plan);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError(null);
    try {
      apply((await mk<{ content: Content }>(`/api/marketing/content/${id}`, { method: 'PATCH', body: { title, brief: brief || null, imageKeys: photos, ...briefBody(plan) } })).content);
      toast.success('Saved. Press "Write with AI" to write the posts again from this brief.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const addChannels = async () => {
    setBusy(true);
    setError(null);
    try {
      await mk(`/api/marketing/content/${id}/posts`, { method: 'POST', body: { channels: addKinds } });
      setAddKinds([]);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add.');
    } finally {
      setBusy(false);
    }
  };

  const runAi = async (channels?: string[]) => {
    setAiBusy(channels ? channels[0] : 'all');
    setAiError(null);
    setAiReport(null);
    try {
      const out = await writeWithAi(Number(id), channels);
      setAiReport(out);
      await reload();
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'The AI could not write these posts.');
    } finally {
      setAiBusy(null);
    }
  };

  const approveAll = async () => {
    setBusy(true);
    setError(null);
    let failed = 0;
    for (const p of (content?.posts ?? []).filter((x) => x.status === 'PENDING_APPROVAL')) {
      try {
        await mk(`/api/marketing/posts/${p.id}/transition`, { method: 'POST', body: { action: 'approve' } });
      } catch {
        failed++;
      }
    }
    await reload();
    setBusy(false);
    if (failed) setError(`${failed} could not be approved.`);
  };

  const remove = async () => {
    setConfirmDelete(false);
    try {
      await mk(`/api/marketing/content/${id}`, { method: 'DELETE' });
      router.push('/marketing/content');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete.');
    }
  };

  const selling = useProductSelling(content?.productId ?? null, content?.campaignId ?? null);
  const savedPlan = content ? JSON.stringify(briefBody(briefFromContent(content))) : '';
  const planDirty = content !== null && (JSON.stringify(briefBody(plan)) !== savedPlan || (brief || null) !== (content.brief ?? null));

  const onPost = (p: Post) => setContent((c) => (c ? { ...c, posts: (c.posts ?? []).map((x) => (x.id === p.id ? p : x)) } : c));

  if (!content) return error ? <ErrorNote message={error} /> : <Loading />;
  const posts = content.posts ?? [];
  const connectedKinds = new Set(channels.filter((c) => c.effectiveStatus === 'CONNECTED').map((c) => c.kind));
  const choices = [...new Set([...(product?.photos.map((p) => p.imageKey) ?? []), ...content.imageKeys])];
  const writable = posts.filter((p) => canRewrite(p.status)).length;
  const pending = posts.filter((p) => p.status === 'PENDING_APPROVAL').length;

  return (
    <div className="space-y-6 max-w-3xl">
      <ErrorNote message={error} />
      <Card className="space-y-4">
        <div>
          <label className="label" htmlFor="ct">Title</label>
          <input id="ct" className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />
        </div>
        <BriefForm value={plan} onChange={setPlan} profile={selling.data?.profile ?? null} urgency={selling.data?.urgency ?? []} hasProduct={content.productId !== null} />
        <div>
          <label className="label" htmlFor="cb">Your note (optional)</label>
          <textarea id="cb" className="input min-h-24" value={brief} onChange={(e) => setBrief(e.target.value)} maxLength={4000} />
        </div>
        {product ? (
          <div>
            <span className="label">Photos from {product.name}</span>
            <PhotoTicker keys={choices} selected={photos} onChange={setPhotos} />
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={saveDetails} disabled={busy || title.trim() === ''}>Save</button>
          <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>Delete</button>
          {content.campaignId ? <Link href={`/marketing/campaigns/${content.campaignId}`} className="btn btn-secondary">Campaign</Link> : null}
        </div>
      </Card>

      {content.productId ? (
        <>
          <ErrorNote message={selling.error} />
          <SellingProfilePanel productId={content.productId} productName={product?.name ?? content.title} profile={selling.data?.profile ?? null} onProfile={selling.setProfile} />
        </>
      ) : null}

      <div className="space-y-3">
        {planDirty ? <p className="text-sm text-amber-700" data-testid="brief-unsaved">You changed the brief. Save it first, so the AI writes from the new one.</p> : null}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-primary" onClick={() => runAi()} disabled={busy || aiBusy !== null || writable === 0 || planDirty} data-testid="write-with-ai">
            {aiBusy === 'all' ? 'The AI is writing…' : 'Write with AI'}
          </button>
          <p className="text-xs text-slate-500">Writes every draft or rejected post for its channel. You still read and approve each one.</p>
        </div>
        <ErrorNote message={aiError} />
        {aiReport ? <DraftReport outcome={aiReport} onClose={() => setAiReport(null)} /> : null}
      </div>

      {pending > 0 ? (
        <button type="button" className="btn btn-primary" onClick={approveAll} disabled={busy} data-testid="approve-all">Approve all for this content ({pending})</button>
      ) : null}

      <div className="space-y-4">
        {posts.length === 0 ? <p className="text-sm text-slate-500">No channels yet. Add some below.</p> : null}
        {posts.map((p) => (
          <PostCard key={p.id} post={p} photoChoices={choices} connected={connectedKinds.has(p.channelKind)} onChange={onPost} title={content.title} aiBusy={aiBusy !== null || planDirty} aiWorking={aiBusy === p.channelKind || aiBusy === 'all'} onRewrite={() => runAi([p.channelKind])} />
        ))}
      </div>

      <Card className="space-y-4">
        <h2 className="font-serif text-xl font-semibold">Add more channels</h2>
        <ChannelPicker channels={channels} selected={addKinds} onChange={setAddKinds} disabled={posts.map((p) => p.channelKind)} />
        <button type="button" className="btn btn-secondary" disabled={busy || addKinds.length === 0} onClick={addChannels}>Add {addKinds.length || ''} post{addKinds.length === 1 ? '' : 's'}</button>
      </Card>

      <ConfirmDialog open={confirmDelete} title="Delete this content?" message="Its draft posts are deleted too. Anything already posted or shared is kept, and then this cannot be deleted." confirmText="Delete" variant="danger" onCancel={() => setConfirmDelete(false)} onConfirm={remove} />
    </div>
  );
}
