'use client';
// AI Marketing Manager prototype: small shared pieces (icons, badges, dialogs).
// Built on the app's global classes (.card, .btn, .input, .badge) from globals.css.
import React, { useEffect, useId, useRef } from 'react';
import type { ShownState } from './engine';

// ------------------------------------------------------------------ icons

const paths: Record<string, React.ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  plan: <><path d="M9 4h6l1 2h3v15H5V6h3z" /><path d="M9 11h6M9 15h4" /></>,
  check: <><path d="M4 12.5 9 17.5 20 6.5" /></>,
  approve: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8 12 3 3 5-6" /></>,
  megaphone: <><path d="M3 10v4h3l7 4V6L6 10z" /><path d="M17 9a4 4 0 0 1 0 6" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6" /></>,
  chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></>,
  plug: <><path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4" /></>,
  sparkle: <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></>,
  reset: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></>,
  pause: <><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></>,
  play: <path d="M7 4.5v15l12-7.5z" />,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  alert: <><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17v.5" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.5" /></>,
  whatsapp: <><path d="M4 20l1.3-4A8 8 0 1 1 8 18.7z" /><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 1c-1-.4-1.6-1-2-2l1-1-1-2z" /></>,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></>,
  forward: <><path d="M5 4.5v15l9-7.5zM15 4.5v15" /></>,
  heart: <path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" />,
  comment: <path d="M4 5h16v11H9l-5 4z" />,
  send: <path d="M3 11.5 21 3l-8.5 18-2-7.5z" />,
  bookmark: <path d="M6 3h12v18l-6-4-6 4z" />,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
};

export function Icon({ name, className = 'h-5 w-5', title }: { name: keyof typeof paths | string; className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title ? <title>{title}</title> : null}
      {paths[name] ?? paths.info}
    </svg>
  );
}

// ------------------------------------------------------------------ labels

type Tone = 'olive' | 'amber' | 'rose' | 'sky' | 'slate' | 'lime' | 'violet';

const TONES: Record<Tone, string> = {
  olive: 'bg-brand-olive-50 text-brand-olive-700 border-brand-olive-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  rose: 'bg-rose-50 text-rose-700 border-rose-200',
  sky: 'bg-sky-50 text-sky-800 border-sky-200',
  slate: 'bg-slate-100 text-slate-700 border-slate-200',
  lime: 'bg-brand-lime-100 text-brand-ink border-brand-lime-200',
  violet: 'bg-violet-50 text-violet-800 border-violet-200',
};

export function Pill({ tone = 'slate', children, className = '' }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONES[tone]} ${className}`}>{children}</span>;
}

export const STATE_TONE: Record<ShownState, Tone> = {
  awaiting: 'amber', ready: 'sky', scheduled: 'sky', published: 'olive', manual: 'violet', failed: 'rose', paused: 'slate',
};

/** Marks anything the prototype pretends an AI wrote or decided. */
export function Simulated({ children = 'Simulated suggestion', className = '' }: { children?: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border border-dashed border-brand-olive-300 bg-white px-2 py-0.5 text-[11px] font-medium text-brand-olive-700 ${className}`} title="Prepared by the prototype from fixed templates. No real AI was used.">
      <Icon name="sparkle" className="h-3.5 w-3.5" />
      {children}
    </span>
  );
}

export function DemoTag({ children = 'Demo only' }: { children?: React.ReactNode }) {
  return <span className="inline-flex items-center rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">{children}</span>;
}

export function SectionTitle({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="font-serif text-xl text-slate-900">{title}</h2>
        {hint ? <p className="text-sm text-slate-500">{hint}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function PageTitle({ eyebrow, title, hint, action }: { eyebrow?: string; title: string; hint?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow ? <p className="brand-label text-brand-olive-700">{eyebrow}</p> : null}
        <h1 className="font-serif text-3xl leading-tight text-slate-900 sm:text-4xl">{title}</h1>
        {hint ? <div className="mt-1 max-w-2xl text-slate-600">{hint}</div> : null}
      </div>
      {action}
    </header>
  );
}

export function Empty({ icon = 'check', title, text, action }: { icon?: string; title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 px-6 py-10 text-center">
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-brand-olive-50 text-brand-olive-700"><Icon name={icon} /></div>
      <p className="font-medium text-slate-900">{title}</p>
      {text ? <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">{text}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Note({ tone = 'info', children, className = '' }: { tone?: 'info' | 'warn' | 'error' | 'ok'; children: React.ReactNode; className?: string }) {
  const cls = {
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
    error: 'border-rose-200 bg-rose-50 text-rose-800',
    ok: 'border-brand-olive-200 bg-brand-olive-50 text-brand-olive-800',
  }[tone];
  const icon = { info: 'info', warn: 'alert', error: 'alert', ok: 'check' }[tone];
  return (
    <div className={`flex gap-2.5 rounded-lg border px-3.5 py-3 text-sm ${cls} ${className}`} role={tone === 'error' ? 'alert' : undefined}>
      <Icon name={icon} className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Working({ steps, label }: { steps: string[]; label: string }) {
  return (
    <div className="card" role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-brand-olive-200 border-t-brand-olive-600" aria-hidden />
        <p className="font-medium text-slate-900">{label}</p>
        <Simulated>Simulated</Simulated>
      </div>
      <ul className="mt-4 space-y-2 text-sm text-slate-600">
        {steps.map((s, i) => (
          <li key={s} className="flex items-center gap-2 opacity-0 animate-[mmfade_.4s_ease-out_forwards]" style={{ animationDelay: `${i * 350}ms` }}>
            <Icon name="check" className="h-4 w-4 text-brand-olive-600" /> {s}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------------ dialog

export function Dialog({ open, onClose, title, children, footer, wide = false }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const first = ref.current?.querySelector<HTMLElement>('textarea, input, select, button:not([data-close])');
    (first ?? ref.current)?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        className={`flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-xl outline-none sm:rounded-2xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <h2 id={id} className="font-serif text-2xl text-slate-900">{title}</h2>
          <button type="button" data-close className="btn btn-ghost !min-h-10 !px-2" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-3 pb-[calc(0.75rem+var(--safe-bottom))]">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: React.ReactNode; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label className="label !mb-0" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 font-serif text-3xl leading-none text-slate-900">{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}
