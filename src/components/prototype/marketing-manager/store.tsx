'use client';
// AI Marketing Manager prototype: browser-local state, the hash router and toasts.
// State lives only in this browser (localStorage). Nothing is sent anywhere.
import React, { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { reducer, type Action } from './engine';
import { STORAGE_KEY, seedState } from './seed';
import type { DemoState } from './types';

interface Toast { id: number; text: string; tone: 'ok' | 'info' | 'warn' }

interface Ctx {
  state: DemoState;
  dispatch: React.Dispatch<Action>;
  route: string[];
  go: (href: string) => void;
  toast: (text: string, tone?: Toast['tone']) => void;
  storageOk: boolean;
}

const DemoCtx = createContext<Ctx | null>(null);

export function useDemo(): Ctx {
  const c = useContext(DemoCtx);
  if (!c) throw new Error('useDemo outside DemoProvider');
  return c;
}

function load(): { state: DemoState; ok: boolean } {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as DemoState;
      // Saved by the first prototype round (one caption per item, no visuals): start fresh instead.
      const current = s && s.version === 1 && Array.isArray(s.materials) && s.materials.every((m) => Array.isArray(m.versions?.[0]?.images));
      if (current) return { state: s, ok: true };
    }
    window.localStorage.setItem(`${STORAGE_KEY}-probe`, '1');
    window.localStorage.removeItem(`${STORAGE_KEY}-probe`);
    return { state: seedState(), ok: true };
  } catch {
    return { state: seedState(), ok: false };
  }
}

const subscribeHash = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

export function DemoProvider({ children }: { children: React.ReactNode }) {
  const [initial] = useState(load);
  const [state, dispatch] = useReducer(reducer, initial.state);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextToast = useRef(1);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage blocked: the demo still works until the page is closed */
    }
  }, [state]);

  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => '');
  const route = hash.replace(/^#\/?/, '').split('/').filter(Boolean);

  const go = useCallback((href: string) => {
    if (window.location.hash !== href) window.location.hash = href;
    window.scrollTo({ top: 0 });
  }, []);

  // One brief notification at a time: a new one replaces the last. Warnings that matter
  // are also shown beside the item they concern, so nothing is lost when this one goes.
  const toast = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = nextToast.current++;
    setToasts([{ id, text, tone }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'warn' ? 6000 : 3500);
  }, []);
  const dismiss = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));

  return (
    <DemoCtx.Provider value={{ state, dispatch, route, go, toast, storageOk: initial.ok }}>
      {children}
      <div className="pointer-events-none fixed bottom-[4.75rem] right-3 z-[60] flex w-[min(22rem,calc(100vw-1.5rem))] justify-end lg:bottom-5 lg:right-5" aria-live="polite" role="status">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex w-full items-start gap-2 rounded-lg py-2.5 pl-3.5 pr-1.5 text-[13px] leading-snug shadow-lg ${t.tone === 'warn' ? 'bg-amber-50 text-amber-900 border border-amber-200' : t.tone === 'info' ? 'bg-white text-slate-800 border border-slate-200' : 'bg-brand-olive-900 text-brand-olive-50'}`}
          >
            <span className="min-w-0 flex-1 py-0.5">{t.text}</span>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss notification" className="shrink-0 rounded px-1.5 text-base leading-none opacity-70 hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-current">×</button>
          </div>
        ))}
      </div>
    </DemoCtx.Provider>
  );
}
