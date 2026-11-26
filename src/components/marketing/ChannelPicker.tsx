'use client';
// ZP-1200: tick channels, grouped by family, showing "automatic" or "you post it" and whether connected.
import React from 'react';
import { groupByFamily, modeLabel } from '@/lib/marketing/ui';
import type { ChannelItem } from './api';

export function ChannelPicker({ channels, selected, onChange, disabled = [] }: { channels: ChannelItem[]; selected: string[]; onChange: (kinds: string[]) => void; disabled?: string[] }) {
  return (
    <div className="space-y-4" data-testid="channel-picker">
      {groupByFamily(channels).map((g) => (
        <fieldset key={g.family}>
          <legend className="text-sm font-semibold text-slate-700 mb-1">{g.label}</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {g.items.map((c) => {
              const off = disabled.includes(c.kind);
              const on = selected.includes(c.kind);
              return (
                <label key={c.kind} className={`flex items-start gap-3 rounded-lg border p-3 min-h-12 cursor-pointer ${on ? 'border-brand-olive bg-brand-olive-50' : 'border-slate-200 bg-white'} ${off ? 'opacity-50 cursor-not-allowed' : ''}`}>
                  <input
                    type="checkbox"
                    className="mt-1 h-5 w-5"
                    checked={on || off}
                    disabled={off}
                    onChange={() => onChange(on ? selected.filter((k) => k !== c.kind) : [...selected, c.kind])}
                    data-testid={`channel-${c.kind}`}
                  />
                  <span className="text-sm">
                    <span className="block font-medium text-slate-900">{c.label}</span>
                    <span className="block text-xs text-slate-500">
                      {modeLabel(c)}
                      {c.mode === 'api' ? (c.effectiveStatus === 'CONNECTED' ? ', connected' : ', not connected yet') : ''}
                      {off ? ' (already added)' : ''}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
