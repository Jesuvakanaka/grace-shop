'use client';
// ZP-505: small building blocks of the Insights page (admin styling).
// Charts are plain HTML bars: every bar prints its number as text, so the
// value never depends on reading the bar; the bar itself is aria-hidden.
import React from 'react';

export const fmt = {
  num(n: number | null | undefined): string {
    return n === null || n === undefined ? '–' : n.toLocaleString('en');
  },
  pct(r: number | null | undefined): string {
    if (r === null || r === undefined || !Number.isFinite(r)) return '–';
    const p = r * 100;
    return `${p > 0 && p < 10 ? p.toFixed(1) : Math.round(p)}%`;
  },
  secs(s: number | null | undefined): string {
    if (s === null || s === undefined || !Number.isFinite(s)) return '–';
    if (s < 60) return `${s.toFixed(1)} s`;
    const m = Math.floor(s / 60);
    return `${m} min ${Math.round(s - m * 60)} s`;
  },
  dec(n: number | null | undefined, digits = 1): string {
    return n === null || n === undefined || !Number.isFinite(n) ? '–' : n.toFixed(digits);
  },
  day(d: string): string {
    return new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  },
};

/** "12 views – too few to rank" */
export function TooFew({ count, unit }: { count: number; unit: string }) {
  return (
    <span className="text-xs text-amber-700" data-testid="too-few">
      {fmt.num(count)} {unit} – too few to rank
    </span>
  );
}

export function Section({
  id,
  title,
  description,
  csv,
  children,
}: {
  id: string;
  title: string;
  description?: React.ReactNode;
  csv?: string[];
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="card p-4 md:p-5 scroll-mt-20 min-w-0" data-testid={`insights-${id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="text-lg font-semibold text-slate-900">
            {title}
          </h2>
          {description && <p className="text-sm text-slate-500 mt-0.5">{description}</p>}
        </div>
        {csv && csv.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {csv.map((href, i) => (
              <a
                key={href}
                href={href}
                download
                className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 whitespace-nowrap"
                data-testid={`csv-${id}${i ? `-${i}` : ''}`}
              >
                CSV{csv.length > 1 ? ` ${i + 1}` : ''}
              </a>
            ))}
          </div>
        )}
      </div>
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, testId }: { label: string; value: string; sub?: React.ReactNode; testId?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 min-w-0" data-testid={testId}>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="text-xl md:text-2xl font-bold tracking-tight text-slate-900 mt-0.5">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}

/** One horizontal bar with its label and printed value. share = 0..1 of the track. */
export function Bar({ label, value, share, note, muted }: { label: React.ReactNode; value: string; share: number | null; note?: React.ReactNode; muted?: boolean }) {
  const w = Math.max(0, Math.min(1, share ?? 0));
  return (
    <li className="min-w-0">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-slate-700 truncate">{label}</span>
        <span className="font-mono text-slate-900 whitespace-nowrap">{value}</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-slate-100" aria-hidden="true">
        <div
          className={`h-2 rounded-full ${muted ? 'bg-slate-300' : 'bg-brand-olive'}`}
          style={{ width: `${w * 100}%`, minWidth: w > 0 ? 4 : 0 }}
        />
      </div>
      {note && <div className="mt-0.5 text-xs text-slate-500">{note}</div>}
    </li>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-slate-500 py-2">{children}</p>;
}

/** A table that scrolls sideways inside its card on a phone (the page never does). */
export function ScrollTable({ children, caption }: { children: React.ReactNode; caption: string }) {
  return (
    <div className="overflow-x-auto -mx-4 md:mx-0 px-4 md:px-0">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export const th = 'px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap';
export const thNum = `${th} text-right`;
export const td = 'px-2 py-2 border-t border-slate-100 align-top';
export const tdNum = `${td} text-right font-mono whitespace-nowrap`;
