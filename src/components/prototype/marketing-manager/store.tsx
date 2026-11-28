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
      if (s && s.version === 1 && Array.isArray(s.materials)) return { state: s, ok: true };
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

  const toast = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = nextToast.current++;
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  return (
    <DemoCtx.Provider value={{ state, dispatch, route, go, toast, storageOk: initial.ok }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-8" aria-live="polite" role="status">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto max-w-md rounded-lg px-4 py-3 text-sm shadow-lg ${t.tone === 'warn' ? 'bg-amber-50 text-amber-900 border border-amber-200' : t.tone === 'info' ? 'bg-white text-slate-800 border border-slate-200' : 'bg-brand-olive-900 text-brand-olive-50'}`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </DemoCtx.Provider>
  );
}
