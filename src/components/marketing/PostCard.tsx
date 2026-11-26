'use client';
// ZP-1200: one post (content as it goes out on one channel): edit the words, see the tracking link,
// move it along (submit, approve, schedule, publish, share ...), and the share bundle for manual channels.
import React, { useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SharePhotos } from '@/components/SharePhotos';
import { useToast } from '@/components/Toast';
import { getChannel } from '@/lib/marketing/channels';
import { attemptsLeft, availableActions, canRewrite, charCount, viewOnlineLabel, fromLocalInput, isEditable, modeLabel, shareCaption, toLocalInput, type ActionButton } from '@/lib/marketing/ui';
import { imageUrlForKey, isValidImageKey } from '@/lib/storage/keys';
import { mk, type Post } from './api';
import { AiTag } from './ai';
import { PhotoTicker, StatusPill } from './parts';

const btnClass = (tone: ActionButton['tone']) => (tone === 'primary' ? 'btn btn-primary' : tone === 'danger' ? 'btn btn-danger' : 'btn btn-secondary');

export function PostCard({
  post,
  photoChoices,
  connected,
  onChange,
  title,
  aiBusy = false,
  aiWorking = false,
  onRewrite,
}: {
  post: Post;
  /** Image keys the owner can pick from (the content's photos). */
  photoChoices: string[];
  connected: boolean;
  onChange: (p: Post) => void;
  title: string;
  aiBusy?: boolean;
  aiWorking?: boolean;
  onRewrite?: () => void;
}) {
  const toast = useToast();
  const ch = getChannel(post.channelKind);
  const [text, setText] = useState(post.text);
  const [keys, setKeys] = useState<string[]>(post.imageKeys);
  const [when, setWhen] = useState(toLocalInput(post.scheduledFor));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ActionButton | null>(null);

  // Take the saved values again when the post changes on the server
  // (the "adjust state while rendering" pattern, instead of an effect).
  const [seen, setSeen] = useState(post);
  if (seen.text !== post.text || seen.imageKeys !== post.imageKeys || seen.scheduledFor !== post.scheduledFor) {
    setSeen(post);
    setText(post.text);
    setKeys(post.imageKeys);
    setWhen(toLocalInput(post.scheduledFor));
  }

  if (!ch) return null;
  const count = charCount(text, ch.limits.maxText);
  const dirty = text !== post.text || JSON.stringify(keys) !== JSON.stringify(post.imageKeys);
  const editable = isEditable(post.status);
  const choices = [...new Set([...photoChoices, ...post.imageKeys])];

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await mk<{ post: Post }>(`/api/marketing/posts/${post.id}`, { method: 'PATCH', body: { text, imageKeys: keys } });
      onChange(d.post);
      toast.success(post.status === 'DRAFT' ? 'Saved.' : 'Saved. It is a draft again and needs approval.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const act = async (a: ActionButton) => {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { action: a.action };
      if (a.needsDate) {
        const iso = fromLocalInput(when);
        if (!iso) throw new Error('Choose a date and time first.');
        body.scheduledFor = iso;
      }
      const d = await mk<{ post: Post }>(`/api/marketing/posts/${post.id}/transition`, { method: 'POST', body });
      onChange(d.post);
      toast.success(`${a.label}: done.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  const copyCaption = async () => {
    try {
      await navigator.clipboard.writeText(shareCaption({ text, link: post.link }));
      toast.success('Caption copied.');
    } catch {
      toast.error('Could not copy. Select the text and copy it by hand.');
    }
  };

  const actions = dirty ? [] : availableActions(post);
  const bundle = ch.mode === 'manual' && post.status === 'APPROVED';

  return (
    <article id={`post-${post.id}`} className="card space-y-4 scroll-mt-20" data-testid={`post-${post.id}`}>
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold text-slate-900">{ch.label}</h3>
        <span className="text-xs text-slate-500">{modeLabel(ch)}</span>
        <span className={`text-xs ${connected ? 'text-brand-olive-700' : 'text-slate-500'}`}>
          {ch.mode === 'manual' ? '' : connected ? 'Connected' : 'Not connected yet'}
        </span>
        {post.aiGenerated ? <AiTag /> : null}
        <span className="ml-auto"><StatusPill status={post.status} /></span>
      </header>

      <div>
        <label className="label" htmlFor={`text-${post.id}`}>Words</label>
        <textarea
          id={`text-${post.id}`}
          className="input min-h-32"
          value={text}
          onChange={(e) => setText(e.target.value)}
          readOnly={!editable}
          data-testid={`post-text-${post.id}`}
        />
        <p className={`mt-1 text-xs ${count.over ? 'text-rose-700 font-medium' : count.near ? 'text-amber-700' : 'text-slate-500'}`} data-testid={`post-count-${post.id}`}>
          {count.count} of {count.max} characters{count.over ? ` (${-count.left} too many)` : ''}
        </p>
      </div>

      {editable && choices.length > 0 ? (
        <div>
          <span className="label">Photos ({ch.limits.maxImages === 0 ? 'none for this channel' : `up to ${ch.limits.maxImages}`})</span>
          <PhotoTicker keys={choices} selected={keys} onChange={setKeys} max={ch.limits.maxImages} />
        </div>
      ) : null}
      {ch.limits.needsImage && keys.length === 0 ? <p className="text-xs text-amber-700">{ch.label} needs at least one photo.</p> : null}

      {editable && dirty ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy || count.over || text.trim() === ''}>Save words and photos</button>
          <p className="text-xs text-slate-500">Changing an approved post sends it back to draft: approval is for the exact words.</p>
        </div>
      ) : null}

      <div className="text-sm">
        <span className="text-slate-500">Tracking link: </span>
        {post.link ? <a className="break-all text-brand-olive-700 underline" href={post.link} target="_blank" rel="noopener noreferrer" data-testid={`post-link-${post.id}`}>{post.link}</a> : <span className="text-slate-400">no link</span>}
        <span className="ml-2 text-xs text-slate-400">({post.trackingTag})</span>
      </div>

      {post.status === 'SCHEDULED' && post.scheduledFor ? <p className="text-sm text-slate-600">Scheduled for {new Date(post.scheduledFor).toLocaleString()}.</p> : null}
      {post.status === 'PUBLISHED' ? (
        <p className="text-sm text-slate-600" data-testid={`published-${post.id}`}>
          Published{post.publishedAt ? ` ${new Date(post.publishedAt).toLocaleString()}` : ''}.{' '}
          {post.externalUrl ? <a className="text-brand-olive-700 underline" href={post.externalUrl} target="_blank" rel="noopener noreferrer">{viewOnlineLabel(post.channelKind)}</a> : null}
        </p>
      ) : post.externalUrl ? <a className="text-sm text-brand-olive-700 underline" href={post.externalUrl} target="_blank" rel="noopener noreferrer">{viewOnlineLabel(post.channelKind)}</a> : null}
      {post.status === 'FAILED' ? (
        <p className="text-sm text-rose-700" data-testid={`failed-${post.id}`}>
          Problem: {post.error ?? 'It did not post.'} {attemptsLeft(post.attempts) > 0 ? `You can try again (${attemptsLeft(post.attempts)} ${attemptsLeft(post.attempts) === 1 ? 'try' : 'tries'} left).` : 'No tries left.'}
        </p>
      ) : post.error ? <p className="text-sm text-rose-700">Problem: {post.error}</p> : null}

      {bundle ? (
        <div className="rounded-lg border border-brand-olive-200 bg-brand-olive-50 p-4 space-y-3" data-testid={`share-bundle-${post.id}`}>
          <h4 className="font-semibold text-slate-900">Share bundle</h4>
          <p className="text-sm text-slate-600">Post this yourself on {ch.label}: share the photos, paste the caption, then press &quot;Mark as shared&quot;.</p>
          <pre className="whitespace-pre-wrap rounded bg-white border border-slate-200 p-3 text-sm" data-testid={`bundle-caption-${post.id}`}>{shareCaption({ text, link: post.link })}</pre>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary min-h-12 px-5" onClick={copyCaption}>Copy caption</button>
          </div>
          <SharePhotos urls={post.imageKeys.filter(isValidImageKey).map(imageUrlForKey)} title={title} text={shareCaption({ text, link: post.link })} />
        </div>
      ) : null}

      {actions.some((a) => a.needsDate) ? (
        <div>
          <label className="label" htmlFor={`when-${post.id}`}>Schedule for</label>
          <input id={`when-${post.id}`} type="datetime-local" className="input max-w-xs" value={when} onChange={(e) => setWhen(e.target.value)} />
        </div>
      ) : null}

      {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert" data-testid={`post-error-${post.id}`}>{error}</p> : null}
      {dirty && editable ? <p className="text-xs text-slate-500">Save your changes to see the buttons.</p> : null}

      {actions.length > 0 || (onRewrite && canRewrite(post.status) && !dirty) ? (
        <div className="flex flex-wrap gap-2">
          {onRewrite && canRewrite(post.status) && !dirty ? (
            <button type="button" className="btn btn-secondary min-h-12" disabled={busy || aiBusy} onClick={onRewrite} data-testid={`rewrite-${post.id}`}>
              {aiWorking ? 'Writing…' : 'Rewrite with AI'}
            </button>
          ) : null}
          {actions.map((a) => (
            <button
              key={a.action}
              type="button"
              className={`${btnClass(a.tone)} min-h-12`}
              disabled={busy}
              onClick={() => (a.action === 'cancel' || a.action === 'reject' ? setConfirm(a) : act(a))}
              data-testid={`action-${a.action}-${post.id}`}
            >
              {a.label}
            </button>
          ))}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.action === 'reject' ? 'Reject this post?' : 'Cancel this post?'}
        message={confirm?.action === 'reject' ? 'It goes back to the writer. You can edit it and submit it again.' : 'It will not be posted. This cannot be undone.'}
        confirmText={confirm?.action === 'reject' ? 'Reject' : 'Cancel post'}
        variant="danger"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const a = confirm;
          setConfirm(null);
          if (a) void act(a);
        }}
      />
    </article>
  );
}
