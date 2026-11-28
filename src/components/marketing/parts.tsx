'use client';
// ZP-1200: shared pieces of the Marketing screens.
import React, { createContext, useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { STATUS_CLASSES, STATUS_LABELS } from '@/lib/marketing/ui';
import { imageUrlForKey, isValidImageKey } from '@/lib/storage/keys';
import { mk, type PickerProduct } from './api';

export interface HubStatusDto {
  enabled: true;
  live: { env: boolean; settings: boolean; connectedChannels: number };
}
export const HubStatusContext = createContext<{ status: HubStatusDto | null; reload: () => void }>({ status: null, reload: () => {} });
export const useHubStatus = () => useContext(HubStatusContext);

const TABS = [
  ['/marketing', 'Overview'],
  ['/marketing/campaigns', 'Campaigns'],
  ['/marketing/content', 'Content'],
  ['/marketing/approvals', 'Approvals'],
  ['/marketing/results', 'Results'],
  ['/marketing/ads', 'Ads'],
  ['/marketing/audiences', 'Audiences'],
  ['/marketing/enquiries', 'Enquiries'],
  ['/marketing/contacts', 'Contacts'],
  ['/marketing/messages', 'Messages'],
  ['/marketing/partners', 'Partners'],
  ['/marketing/channels', 'Channels'],
  ['/marketing/settings', 'Settings'],
  ['/marketing/activity', 'Activity'],
] as const;

export function MarketingTabs() {
  const pathname = usePathname() ?? '';
  return (
    <nav className="mb-6 -mx-1 flex gap-1 overflow-x-auto pb-1" aria-label="Marketing sections" data-testid="marketing-tabs">
      {TABS.map(([href, label]) => {
        const active = href === '/marketing' ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`shrink-0 rounded-full px-4 py-2 text-sm min-h-10 inline-flex items-center ${active ? 'bg-brand-olive-50 text-brand-olive-700 font-medium border border-brand-olive-200' : 'text-slate-600 hover:bg-slate-50 border border-transparent'}`}
            data-testid={`marketing-tab-${label.toLowerCase()}`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_CLASSES[status] ?? 'bg-slate-100 text-slate-600 border-slate-200'}`} data-testid="post-status">
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function Card({ children, className = '', 'data-testid': testId }: { children: React.ReactNode; className?: string; 'data-testid'?: string }) {
  return <section className={`card ${className}`} data-testid={testId}>{children}</section>;
}

export function Loading({ what = 'Loading…' }: { what?: string }) {
  return <p className="text-slate-500 py-8 text-center" role="status">{what}</p>;
}

export function ErrorNote({ message }: { message: string | null }) {
  return message ? <p className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" role="alert">{message}</p> : null;
}

/** Photos you can tick. `urls` are the choices; `selected` are image keys. */
export function PhotoTicker({ keys, selected, onChange, max }: { keys: string[]; selected: string[]; onChange: (keys: string[]) => void; max?: number }) {
  if (keys.length === 0) return <p className="text-sm text-slate-500">This product has no photos yet.</p>;
  return (
    <div className="flex flex-wrap gap-3" data-testid="photo-ticker">
      {keys.filter(isValidImageKey).map((key) => {
        const on = selected.includes(key);
        const blocked = !on && max !== undefined && selected.length >= max;
        return (
          <label key={key} className={`relative cursor-pointer ${blocked ? 'opacity-40' : ''}`}>
            <input
              type="checkbox"
              className="absolute left-1.5 top-1.5 h-5 w-5 z-10"
              checked={on}
              disabled={blocked}
              onChange={() => onChange(on ? selected.filter((k) => k !== key) : [...selected, key])}
              aria-label="Use this photo"
            />
            {/* eslint-disable-next-line @next/next/no-img-element -- private same-origin picture */}
            <img src={imageUrlForKey(key)} alt="" className={`h-24 w-24 rounded-lg object-cover border-2 ${on ? 'border-brand-olive' : 'border-slate-200'}`} />
          </label>
        );
      })}
    </div>
  );
}

/** Search published products; calls onPick with the chosen one. `extraIds` keeps already chosen products listed. */
export function ProductSearch({ onPick, extraIds = [], pickedIds = [], label = 'Find a product' }: { onPick: (p: PickerProduct) => void; extraIds?: number[]; pickedIds?: number[]; label?: string }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<PickerProduct[]>([]);
  const [error, setError] = useState<string | null>(null);
  const extra = extraIds.join(',');
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      mk<{ products: PickerProduct[] }>(`/api/marketing/products?q=${encodeURIComponent(q)}${extra ? `&ids=${extra}` : ''}`)
        .then((d) => !cancelled && (setItems(d.products), setError(null)))
        .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Could not search.'));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, extra]);
  return (
    <div data-testid="product-search">
      <label className="label" htmlFor="product-search-input">{label}</label>
      <input id="product-search-input" className="input mb-2" type="search" placeholder="Search published products" value={q} onChange={(e) => setQ(e.target.value)} />
      <ErrorNote message={error} />
      <ul className="max-h-64 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {items.length === 0 ? <li className="p-3 text-sm text-slate-500">No published products found.</li> : null}
        {items.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => onPick(p)} className="flex w-full items-center gap-3 p-2 text-left hover:bg-slate-50 min-h-12" data-testid={`product-option-${p.id}`}>
              {p.photos[0] ? (
                // eslint-disable-next-line @next/next/no-img-element -- private same-origin picture
                <img src={p.photos[0].url} alt="" className="h-10 w-10 rounded object-cover" />
              ) : (
                <span className="h-10 w-10 rounded bg-slate-100" />
              )}
              <span className="flex-1 text-sm">{p.name}</span>
              {pickedIds.includes(p.id) ? <span className="text-xs text-brand-olive-700">Chosen</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
