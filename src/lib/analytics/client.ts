// ZP-493: the storefront's analytics API for client components.
//
//   import { track, useDwell, useActiveDwell } from '@/lib/analytics/client'
//   track('look_view', { slug, collection, position })
//   useDwell(slideRef, (seconds) => track('look_dwell', { slug, collection, seconds }))
//
// One tracker per page, created on first use (or by <AnalyticsProvider> in
// src/app/site/layout.tsx, which starts the visit). Outside a browser (server
// rendering, node tests) everything here is a no-op. GPC / DNT, automated
// browsers and preview pages get a disabled tracker. See
// docs/storefront/analytics.md for the event catalogue and how to call it.
import { useEffect, useRef, type RefObject } from 'react'
import {
  ANALYTICS_ENDPOINT,
  createAnalyticsClient,
  disabledAnalyticsClient,
  type AnalyticsClient,
  type AnalyticsEnv,
  type StorageLike,
  type TrackProps,
} from './client-core'
import { createDwellTimer, createDwellTracker, documentVisibility } from './dwell'
import type { AnalyticsEventType } from './events'

export type { AnalyticsEventType } from './events'
export type { TrackProps } from './client-core'
export { createDwellTimer, createDwellTracker, DWELL_MAX_SECONDS, DWELL_MIN_SECONDS, DWELL_VISIBLE_RATIO } from './dwell'

let client: AnalyticsClient | null = null

function storage(kind: 'sessionStorage' | 'localStorage'): StorageLike | null {
  try {
    return window[kind] ?? null
  } catch {
    return null // blocked (Safari private mode, sandboxed iframe)
  }
}

function randomUuid(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  const b = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b)
  else for (let i = 0; i < 16; i += 1) b[i] = Math.floor(Math.random() * 256)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

function browserEnv(): AnalyticsEnv {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string }
  return {
    endpoint: ANALYTICS_ENDPOINT,
    now: () => Date.now(),
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (h) => window.clearTimeout(h as number),
    session: storage('sessionStorage'),
    local: storage('localStorage'),
    sendBeacon: typeof nav.sendBeacon === 'function' ? (url, body) => nav.sendBeacon(url, body) : null,
    fetch: typeof window.fetch === 'function' ? (url, init) => window.fetch(url, init) : null,
    randomId: randomUuid,
    // Live: client-side navigation changes the page of later events.
    location: {
      get pathname() {
        return window.location.pathname
      },
      get search() {
        return window.location.search
      },
      get host() {
        return window.location.host
      },
    },
    referrer: document.referrer,
    navigator: {
      userAgent: nav.userAgent,
      language: nav.language,
      maxTouchPoints: nav.maxTouchPoints,
      globalPrivacyControl: nav.globalPrivacyControl,
      doNotTrack: nav.doNotTrack,
      msDoNotTrack: nav.msDoNotTrack,
      webdriver: nav.webdriver,
    },
    windowDoNotTrack: (window as Window & { doNotTrack?: string }).doNotTrack ?? null,
    viewport: () => ({ width: window.innerWidth, height: window.innerHeight }),
    visibility: documentVisibility,
    onPageHide: (fn) => window.addEventListener('pagehide', fn),
  }
}

/** The page's tracker (created on first call). Disabled outside a browser. */
export function initAnalytics(): AnalyticsClient {
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof navigator === 'undefined') {
    return disabledAnalyticsClient()
  }
  if (!client) {
    try {
      client = createAnalyticsClient(browserEnv())
    } catch {
      client = disabledAnalyticsClient()
    }
  }
  return client
}

/**
 * Record one event. `slug` (the piece) and `collection` (the feed tab) go on
 * the event itself; everything else must be a prop allowed for that type in
 * EVENT_SPECS (src/lib/analytics/events.ts), or the server drops the batch.
 */
export function track(type: AnalyticsEventType, props?: TrackProps): void {
  initAnalytics().track(type, props)
}

/** Send what is queued now (normally not needed: page hide flushes). */
export function flushAnalytics(): void {
  initAnalytics().flush()
}

function useLatest<T>(value: T) {
  const ref = useRef(value)
  useEffect(() => {
    ref.current = value
  })
  return ref
}

/**
 * Dwell of an element (>= 60% visible and page visible; < 0.5 s ignored,
 * capped at 60 s), reported through onDwell(seconds) when it leaves the
 * view, when the page hides and on unmount. Pass `root` for a scroll
 * container other than the viewport (a horizontal photo carousel).
 * `key` restarts the tracker (e.g. the slide now shows another piece).
 */
export function useDwell(
  ref: RefObject<Element | null>,
  onDwell: (seconds: number) => void,
  options: { enabled?: boolean; threshold?: number; root?: RefObject<Element | null>; key?: unknown } = {},
): void {
  const latest = useLatest(onDwell)
  const { enabled = true, threshold, root, key } = options
  useEffect(() => {
    const el = ref.current
    if (!enabled || !el || !initAnalytics().enabled) return
    const tracker = createDwellTracker(el, {
      onDwell: (s) => latest.current(s),
      threshold,
      root: root?.current ?? null,
    })
    return () => tracker.stop()
  }, [ref, root, enabled, threshold, key, latest])
}

/**
 * Dwell driven by your own state instead of IntersectionObserver, e.g. the
 * active photo of a carousel: `useActiveDwell(isActive, (s) => track(...))`.
 * Counts while `active` is true and the page is visible; same rules.
 */
export function useActiveDwell(active: boolean, onDwell: (seconds: number) => void, key?: unknown): void {
  const latest = useLatest(onDwell)
  const timerRef = useRef<ReturnType<typeof createDwellTimer> | null>(null)
  useEffect(() => {
    if (!initAnalytics().enabled) return
    const timer = createDwellTimer({ onDwell: (s) => latest.current(s) })
    timerRef.current = timer
    return () => {
      timer.dispose()
      timerRef.current = null
    }
  }, [key, latest])
  useEffect(() => {
    timerRef.current?.setInView(active)
  }, [active, key])
}
