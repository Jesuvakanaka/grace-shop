'use client';
// AI Marketing Manager prototype: realistic-looking channel previews. They are
// pictures of how an item would look, built from the caption and lookbook photos.
// They are clearly marked as demonstration material.
import React from 'react';
import { Mark } from '@/components/storefront/Brand';
import { FORMATS, textLimit, type FormatId } from './catalog';
import type { Look, Scene } from './types';
import { Icon } from './ui';

/** Shows {first name} and [add …] placeholders as highlighted chips. */
export function RichText({ text, className = '' }: { text: string; className?: string }) {
  const parts = text.split(/(\{first name\}|\[[^\]]+\])/g);
  return (
    <span className={`whitespace-pre-wrap ${className}`}>
      {parts.map((p, i) =>
        p === '{first name}' ? (
          <mark key={i} className="rounded bg-sky-100 px-1 text-sky-900" title="Filled in with each customer's first name">first name</mark>
        ) : /^\[[^\]]+\]$/.test(p) ? (
          <mark key={i} className="rounded bg-amber-100 px-1 font-medium text-amber-900" title="Unknown: you need to fill this in">{p}</mark>
        ) : (
          <React.Fragment key={i}>{p}</React.Fragment>
        ),
      )}
    </span>
  );
}

function Avatar({ size = 'h-8 w-8' }: { size?: string }) {
  return (
    <span className={`flex ${size} shrink-0 items-center justify-center rounded-full bg-brand-cream-200 ring-1 ring-brand-olive-200`}>
      <Mark className="h-5 w-5" title="" />
    </span>
  );
}

/** Simulated visual treatments, drawn with CSS on the sample photo. Nothing is generated. */
export const LOOKS: Record<Look, { label: string; hint: string }> = {
  original: { label: 'Original photo', hint: 'The lookbook photo as it is.' },
  warm: { label: 'Warm light', hint: 'Softer, warmer colours.' },
  studio: { label: 'Studio frame', hint: 'The photo on a clean cream background.' },
  headline: { label: 'Headline on photo', hint: 'The opening line set on the picture.' },
};

const LOOK_CLASS: Record<Look, string> = {
  original: '',
  warm: '[filter:sepia(0.22)_saturate(1.25)_brightness(1.03)]',
  studio: 'p-[9%] bg-brand-cream-100 [&>img]:rounded-md [&>img]:shadow-md',
  headline: '',
};

function Photo({ src, className = '', alt = '', look = 'original', headline }: { src: string; className?: string; alt?: string; look?: Look; headline?: string }) {
  return (
    <span className={`relative block h-full w-full overflow-hidden ${LOOK_CLASS[look]}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- fixed local lookbook files in a prototype preview */}
      <img src={src} alt={alt} className={`h-full w-full object-cover ${className}`} loading="lazy" />
      {look === 'headline' && headline ? (
        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-4 pb-4 pt-14 text-left font-serif text-[22px] leading-tight text-white">{headline}</span>
      ) : null}
    </span>
  );
}

/** A small swatch of one simulated look, for choosing between them. */
export function LookSwatch({ src, look }: { src: string; look: Look }) {
  return <span className="block aspect-[4/5] w-full overflow-hidden rounded-md bg-brand-cream-100"><Photo src={src} look={look} headline={look === 'headline' ? 'Aa' : undefined} className="object-top" /></span>;
}

const first = (caption: string) => caption.split('\n\n')[0];

export function Preview({ format, caption, images, look = 'original', scenes, shop }: { format: FormatId; caption: string; images: string[]; look?: Look; scenes?: Scene[]; shop: string }) {
  const opening = first(caption).replace('{first name}', 'Rudo');
  const handle = (shop || 'vyra').toLowerCase().replace(/[^a-z0-9]/g, '') || 'shop';
  const alt = 'Sample lookbook photo used as demonstration campaign material';
  const body = (() => {
    switch (format) {
      case 'ig_post':
      case 'ad':
        return (
          <div className="mx-auto w-full max-w-[360px] overflow-hidden rounded-xl border border-slate-200 bg-white text-[13px] text-slate-900 shadow-sm">
            <div className="flex items-center gap-2 px-3 py-2">
              <Avatar />
              <div className="leading-tight">
                <p className="font-semibold">{handle}</p>
                <p className="text-[11px] text-slate-500">{format === 'ad' ? 'Sponsored' : 'Harare'}</p>
              </div>
            </div>
            <div className="aspect-square bg-brand-cream-100"><Photo src={images[0]} alt={alt} look={look} headline={opening} className="object-top" /></div>
            {format === 'ad' ? (
              <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2 text-[13px] font-semibold">
                <span>Send WhatsApp message</span><Icon name="arrow" className="h-4 w-4" />
              </div>
            ) : null}
            <div className="flex gap-3 px-3 pt-2 text-slate-800"><Icon name="heart" /><Icon name="comment" /><Icon name="send" /><span className="ml-auto"><Icon name="bookmark" /></span></div>
            <p className="px-3 pb-3 pt-1"><span className="font-semibold">{handle}</span> <RichText text={caption} /></p>
          </div>
        );
      case 'ig_story':
      case 'wa_status':
        return (
          <div className="relative mx-auto aspect-[9/16] w-full max-w-[280px] overflow-hidden rounded-2xl bg-black text-white shadow-sm">
            <Photo src={images[0]} alt={alt} look={look === 'headline' ? 'original' : look} className="object-top" />
            <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/60 to-transparent p-3">
              <div className="mb-2 h-0.5 w-full rounded bg-white/40"><div className="h-0.5 w-1/3 rounded bg-white" /></div>
              <div className="flex items-center gap-2 text-[12px] font-semibold"><Avatar size="h-7 w-7" />{format === 'wa_status' ? 'My status' : handle}</div>
            </div>
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-4 pt-16">
              <p className="font-serif text-2xl leading-tight"><RichText text={first(caption)} /></p>
              {format === 'ig_story' ? (
                <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-900"><Icon name="whatsapp" className="h-4 w-4" /> Ask on WhatsApp</span>
              ) : (
                <p className="mt-2 line-clamp-3 text-[12px] text-white/90"><RichText text={caption.split('\n\n').slice(1).join(' ')} /></p>
              )}
            </div>
          </div>
        );
      case 'ig_reel':
      case 'tiktok_video':
        return (
          <div className="mx-auto w-full max-w-[280px]">
            <div className="relative aspect-[9/16] overflow-hidden rounded-2xl bg-black text-white shadow-sm">
              <Photo src={(scenes?.[0]?.image) ?? images[0]} alt={alt} look={look} headline={scenes?.[0]?.text} className="object-top" />
              <span className="absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/50"><Icon name="play" className="h-7 w-7 fill-white" /></span>
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 pt-12 text-[12px]">
                <p className="font-semibold">@{handle}</p>
                <p className="line-clamp-2 text-white/90"><RichText text={caption} /></p>
              </div>
            </div>
            <p className="mt-3 text-xs font-medium uppercase tracking-wider text-slate-500">Storyboard, {(scenes ?? []).length} scenes · {(scenes ?? []).reduce((a, b) => a + b.secs, 0)} seconds</p>
            <div className="mt-1.5 grid grid-cols-3 gap-1.5">
              {(scenes ?? []).map((sc, i) => (
                <div key={i} className="overflow-hidden rounded-md border border-slate-200 bg-white">
                  <div className="aspect-[3/4]"><Photo src={sc.image} alt="" look={look === 'headline' ? 'original' : look} className="object-top" /></div>
                  <p className="px-1.5 py-1 text-[10.5px] leading-tight text-slate-700">{i + 1}. {sc.text} <span className="text-slate-500">· {sc.secs}s</span></p>
                </div>
              ))}
            </div>
          </div>
        );
      case 'fb_post':
      case 'fb_group':
        return (
          <div className="mx-auto w-full max-w-[400px] overflow-hidden rounded-xl border border-slate-200 bg-white text-[14px] text-slate-900 shadow-sm">
            <div className="flex items-center gap-2 px-3 py-2.5">
              <Avatar size="h-9 w-9" />
              <div className="leading-tight">
                <p className="font-semibold">{format === 'fb_group' ? `${shop} in Harare Fashion Finds` : shop}</p>
                <p className="text-[12px] text-slate-500">{format === 'fb_group' ? 'Group post' : 'Just now'} · Public</p>
              </div>
            </div>
            <p className="px-3 pb-2"><RichText text={caption} /></p>
            <div className="aspect-[4/5] bg-brand-cream-100"><Photo src={images[0]} alt={alt} look={look} headline={opening} className="object-top" /></div>
            <div className="flex justify-around border-t border-slate-200 py-2 text-[13px] text-slate-600"><span>Like</span><span>Comment</span><span>Share</span></div>
          </div>
        );
      case 'wa_message':
      case 'wa_channel':
        return (
          <div className="mx-auto w-full max-w-[360px] overflow-hidden rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-2 bg-[#075e54] px-3 py-2.5 text-white">
              <Avatar size="h-8 w-8" />
              <div className="leading-tight text-[13px]"><p className="font-semibold">{shop}</p><p className="text-white/80 text-[11px]">{format === 'wa_channel' ? 'Channel' : 'Business account'}</p></div>
            </div>
            <div className="bg-[#efeae2] p-3">
              <div className="max-w-[88%] overflow-hidden rounded-lg bg-white text-[13.5px] text-slate-900 shadow-sm">
                <div className="aspect-[4/3]"><Photo src={images[0]} alt={alt} look={look} headline={opening} className="object-top" /></div>
                <p className="px-2.5 py-2"><RichText text={caption} /></p>
                <p className="px-2.5 pb-1.5 text-right text-[10.5px] text-slate-500">10:00</p>
              </div>
              {format === 'wa_message' ? <p className="mt-2 text-center text-[11px] text-slate-600">Only sent to people who agreed to marketing messages.</p> : null}
            </div>
          </div>
        );
    }
  })();
  const limit = textLimit(FORMATS[format].channel);
  const over = limit !== null && caption.length > limit;
  return (
    <figure>
      {body}
      <figcaption className="mt-3 space-y-1 text-center text-xs text-slate-500">
        <p>Demonstration material · sample lookbook photo{look !== 'original' ? ` · ${LOOKS[look].label.toLowerCase()} (simulated)` : ''} · not posted anywhere</p>
        {limit !== null ? (
          <p className={over ? 'font-medium text-rose-700' : ''}>
            {caption.length.toLocaleString('en-US')} of {limit.toLocaleString('en-US')} characters{over ? ': too long for this channel' : ''}
          </p>
        ) : null}
        {format === 'ig_story' || format === 'wa_status' ? <p>Stories show the opening line only.</p> : null}
      </figcaption>
    </figure>
  );
}
