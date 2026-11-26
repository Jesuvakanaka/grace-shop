'use client';
// ZP-1200: one content idea and its per-channel posts.
import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useToast } from '@/components/Toast';
import { ChannelPicker } from '@/components/marketing/ChannelPicker';
import { PostCard } from '@/components/marketing/PostCard';
import { mk, type ChannelItem, type Content, type PickerProduct, type Post } from '@/components/marketing/api';
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
  const [photos, setPhotos] = useState<string[]>([]);
  const [addKinds, setAddKinds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const apply = useCallback((c: Content) => {
    setContent(c);
    setTitle(c.title);
    setBrief(c.brief ?? '');
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
    setBusy(true);
    setError(null);
    try {
      apply((await mk<{ content: Content }>(`/api/marketing/content/${id}`, { method: 'PATCH', body: { title, brief: brief || null, imageKeys: photos } })).content);
      toast.success('Saved. Photos on posts are changed on each post.');
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

  const onPost = (p: Post) => setContent((c) => (c ? { ...c, posts: (c.posts ?? []).map((x) => (x.id === p.id ? p : x)) } : c));

  if (!content) return error ? <ErrorNote message={error} /> : <Loading />;
  const posts = content.posts ?? [];
  const connectedKinds = new Set(channels.filter((c) => c.effectiveStatus === 'CONNECTED').map((c) => c.kind));
  const choices = [...new Set([...(product?.photos.map((p) => p.imageKey) ?? []), ...content.imageKeys])];
  const pending = posts.filter((p) => p.status === 'PENDING_APPROVAL').length;

  return (
    <div className="space-y-6 max-w-3xl">
      <ErrorNote message={error} />
      <Card className="space-y-4">
        <div>
          <label className="label" htmlFor="ct">Title</label>
          <input id="ct" className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />
        </div>
        <div>
          <label className="label" htmlFor="cb">What do you want to say?</label>
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

      {pending > 0 ? (
        <button type="button" className="btn btn-primary" onClick={approveAll} disabled={busy} data-testid="approve-all">Approve all for this content ({pending})</button>
      ) : null}

      <div className="space-y-4">
        {posts.length === 0 ? <p className="text-sm text-slate-500">No channels yet. Add some below.</p> : null}
        {posts.map((p) => (
          <PostCard key={p.id} post={p} photoChoices={choices} connected={connectedKinds.has(p.channelKind)} onChange={onPost} title={content.title} />
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
