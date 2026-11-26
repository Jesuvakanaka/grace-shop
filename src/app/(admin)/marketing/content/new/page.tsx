'use client';
// ZP-1200: new content: pick a product and photos, write the idea, tick the channels.
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/Toast';
import { ChannelPicker } from '@/components/marketing/ChannelPicker';
import { mk, type Campaign, type ChannelItem, type Content, type PickerProduct } from '@/components/marketing/api';
import { DraftReport, SuggestionsPanel, writeWithAi, type DraftOutcome } from '@/components/marketing/ai';
import { productIdFromQuery } from '@/lib/marketing/ui';
import { Card, ErrorNote, PhotoTicker, ProductSearch } from '@/components/marketing/parts';

export default function NewContentPage() {
  const router = useRouter();
  const toast = useToast();
  const [product, setProduct] = useState<PickerProduct | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [channels, setChannels] = useState<ChannelItem[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Content | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiReport, setAiReport] = useState<DraftOutcome | null>(null);

  useEffect(() => {
    mk<{ channels: ChannelItem[] }>('/api/marketing/channels').then((d) => setChannels(d.channels)).catch((e) => setError(e.message));
    const c = new URLSearchParams(window.location.search).get('campaignId');
    mk<{ campaigns: Campaign[] }>('/api/marketing/campaigns')
      .then((d) => {
        setCampaigns(d.campaigns);
        if (c) setCampaignId(c);
      })
      .catch(() => {});
    const pid = productIdFromQuery(window.location.search);
    if (pid) {
      mk<{ products: PickerProduct[] }>(`/api/marketing/products?ids=${pid}`)
        .then((d) => {
          const p = d.products.find((x) => x.id === pid);
          if (p) { setProduct(p); setPhotos(p.photos.slice(0, 3).map((x) => x.imageKey)); setTitle((t) => t || p.name); }
        })
        .catch(() => {});
    }
  }, []);

  const choose = (p: PickerProduct) => {
    setProduct(p);
    setPhotos(p.photos.slice(0, 3).map((x) => x.imageKey));
    if (!title) setTitle(p.name);
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { title, brief: brief || null, imageKeys: photos, channels: picked };
      if (product) body.productId = product.id;
      if (campaignId) body.campaignId = Number(campaignId);
      const d = await mk<{ content: Content }>('/api/marketing/content', { method: 'POST', body });
      toast.success('Content created.');
      if (picked.length === 0) router.push(`/marketing/content/${d.content.id}`);
      else { setCreated(d.content); setBusy(false); }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create.');
      setBusy(false);
    }
  };

  const aiNow = async () => {
    if (!created) return;
    setAiBusy(true);
    setError(null);
    try {
      const out = await writeWithAi(created.id);
      setAiReport(out);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The AI could not write these posts.');
    } finally {
      setAiBusy(false);
    }
  };

  if (created) {
    return (
      <div className="space-y-4 max-w-3xl" data-testid="content-created">
        <ErrorNote message={error} />
        <Card className="space-y-4">
          <h2 className="font-serif text-xl font-semibold">Your content is ready</h2>
          <p className="text-sm text-slate-600">The posts are created as drafts with your words. You can let the AI write each one properly for its channel, or edit them by hand.</p>
          {aiReport ? <DraftReport outcome={aiReport} /> : null}
          <div className="flex flex-wrap gap-3">
            {!aiReport ? <button type="button" className="btn btn-primary" onClick={aiNow} disabled={aiBusy} data-testid="write-ai-now">{aiBusy ? 'The AI is writing…' : 'Write the posts with AI now'}</button> : null}
            <button type="button" className={aiReport ? 'btn btn-primary' : 'btn btn-secondary'} onClick={() => router.push(`/marketing/content/${created.id}`)} data-testid="edit-by-hand">{aiReport ? 'Open the posts' : 'Edit by hand'}</button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <form onSubmit={create} className="space-y-6 max-w-3xl">
      <ErrorNote message={error} />
      {!product ? <SuggestionsPanel limit={4} /> : null}
      <Card className="space-y-4">
        <h2 className="font-serif text-xl font-semibold">1. Product (optional)</h2>
        {product ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm">Chosen: <strong>{product.name}</strong></p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setProduct(null); setPhotos([]); }}>Change</button>
          </div>
        ) : (
          <ProductSearch onPick={choose} />
        )}
        {product ? (
          <div>
            <span className="label">Tick the photos to use</span>
            <PhotoTicker keys={product.photos.map((p) => p.imageKey)} selected={photos} onChange={setPhotos} />
          </div>
        ) : null}
      </Card>

      <Card className="space-y-4">
        <h2 className="font-serif text-xl font-semibold">2. The idea</h2>
        <div>
          <label className="label" htmlFor="c-title">Title</label>
          <input id="c-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} required data-testid="content-title" />
        </div>
        <div>
          <label className="label" htmlFor="c-brief">What do you want to say?</label>
          <textarea id="c-brief" className="input min-h-28" value={brief} onChange={(e) => setBrief(e.target.value)} maxLength={4000} data-testid="content-brief" />
          <p className="text-xs text-slate-500 mt-1">This becomes the first words of every post. You can change each one after.</p>
        </div>
        <div>
          <label className="label" htmlFor="c-camp">Campaign (optional)</label>
          <select id="c-camp" className="select" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
            <option value="">No campaign</option>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="font-serif text-xl font-semibold">3. Where will it go?</h2>
        <ChannelPicker channels={channels} selected={picked} onChange={setPicked} />
      </Card>

      <button type="submit" className="btn btn-primary" disabled={busy || title.trim() === ''} data-testid="content-create">
        {busy ? 'Creating…' : `Create ${picked.length} post${picked.length === 1 ? '' : 's'}`}
      </button>
    </form>
  );
}
