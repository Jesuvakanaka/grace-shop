// ZP-507: "Love it" hearts in the browser. One store for the whole page
// (every heart of a piece agrees: feed rail, product page), backed by
// localStorage `vyra:loves` (read and written in try/catch: storage blocked
// means the heart lasts for this page only). The server is told through
// POST /api/public/loves, one request per piece at a time (./sync), with the
// analytics device id (`vyra:analytics:device`, owner decision): no device id
// (GPC / DNT, storage blocked) means the heart stays on this phone only.
// Also tracks love_on / love_off. See docs/storefront/hearts.md.
import { useCallback, useSyncExternalStore } from "react";
import { initAnalytics, track } from "@/lib/analytics/client";
import { DEVICE_STORAGE_KEY } from "@/lib/analytics/client-core";
import { isUuidV4 } from "@/lib/analytics/events";
import { displayLoves, LOVES_ENDPOINT, LOVES_STORAGE_KEY, parseLovedSlugs, serializeLovedSlugs, withLoved } from "./model";
import { createLoveSync } from "./sync";

function local(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readStored(): string[] {
  try {
    return parseLovedSlugs(local()?.getItem(LOVES_STORAGE_KEY));
  } catch {
    return [];
  }
}

/** This page load's view: what was loved when the page first asked, and now. */
let initial: Set<string> | null = null;
let current: string[] = [];
const listeners = new Set<() => void>();

function ensureLoaded() {
  if (initial) return;
  current = readStored();
  initial = new Set(current);
}

function notify() {
  for (const fn of [...listeners]) fn();
}

function subscribe(fn: () => void) {
  ensureLoaded();
  listeners.add(fn);
  // Another tab loved or un-loved something.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== LOVES_STORAGE_KEY) return;
    current = readStored();
    notify();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

function deviceId(): string | null {
  initAnalytics(); // creates the device id if analytics is on
  try {
    const id = local()?.getItem(DEVICE_STORAGE_KEY) ?? null;
    return isUuidV4(id) ? id : null;
  } catch {
    return null;
  }
}

const sync = createLoveSync({
  send: async (slug, on) => {
    const device = deviceId();
    if (!device) return true; // nothing to tell the server: this phone only
    try {
      const res = await fetch(LOVES_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, on, device }),
        credentials: "same-origin",
        keepalive: true,
      });
      return res.ok;
    } catch {
      return false;
    }
  },
});

/** Love or un-love a piece on this phone (and tell the server). */
export function setLoved(slug: string, on: boolean): void {
  ensureLoaded();
  const has = current.includes(slug);
  if (has === on) return;
  current = withLoved(current, slug, on);
  try {
    local()?.setItem(LOVES_STORAGE_KEY, serializeLovedSlugs(current));
  } catch {
    // Storage full or blocked: the heart lasts for this page only.
  }
  notify();
  track(on ? "love_on" : "love_off", { slug });
  sync.set(slug, on);
}

/** 0: not loved, 1: loved now, 2: loved at load, 3: both. Stable numbers for useSyncExternalStore. */
function codeFor(slug: string): number {
  ensureLoaded();
  return (current.includes(slug) ? 1 : 0) + (initial?.has(slug) ? 2 : 0);
}

/**
 * The heart of one piece: whether it is loved on this phone, the count to show
 * (`serverLoves` from the cached catalogue, adjusted by what this phone changed
 * since the page loaded) and the toggle. Not loved and the server count during
 * the server render and hydration (no flash, no mismatch).
 */
export function useLove(slug: string, serverLoves: number | undefined) {
  const code = useSyncExternalStore(
    subscribe,
    () => codeFor(slug),
    () => 0,
  );
  const loved = (code & 1) === 1;
  const lovedAtLoad = (code & 2) === 2;
  const toggle = useCallback(() => setLoved(slug, !loved), [slug, loved]);
  return { loved, loves: displayLoves(serverLoves, loved, lovedAtLoad), toggle };
}
