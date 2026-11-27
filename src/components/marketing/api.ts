'use client';
// ZP-1200: tiny fetch helper for the marketing screens. Throws Error(message) with the API's plain message.
export async function mk<T = Record<string, unknown>>(url: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(url, {
    method: init.method ?? 'GET',
    headers: init.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(typeof data.error === 'string' && data.error ? data.error : `Something went wrong (${res.status}).`);
  return data;
}

export interface Post {
  id: number;
  contentId: number;
  channelKind: string;
  format: string;
  text: string;
  imageKeys: string[];
  trackingTag: string;
  link: string | null;
  status: string;
  scheduledFor: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  publishedAt: string | null;
  externalUrl: string | null;
  error: string | null;
  attempts: number;
  aiGenerated?: boolean;
  aiCostCents?: number;
  aiOpenings?: string[];
  aiNotes?: string[];
}

export interface Content {
  id: number;
  title: string;
  brief: string | null;
  job?: string | null;
  reader?: string | null;
  message?: string | null;
  proof?: string | null;
  urgencyKind?: string | null;
  urgencyText?: string | null;
  action?: string | null;
  campaignId: number | null;
  productId: number | null;
  imageKeys: string[];
  posts?: Post[];
}

export interface Campaign {
  id: number;
  name: string;
  goal: string | null;
  objective: string;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  budgetCents: number | null;
  notes: string | null;
  productIds: number[];
}

export interface PickerProduct {
  id: number;
  name: string;
  slug: string | null;
  photos: { imageKey: string; url: string; isPrimary: boolean }[];
}

import type { ChannelDef } from '@/lib/marketing/channels';
export type ChannelItem = ChannelDef & { channel: { id: number; status: string; name: string; tokenHint: string | null; lastError: string | null; connectedAt: string | null; connectedBy: string | null } | null; effectiveStatus: string };
