// ZP-493: the browser tracker, framework-free and with every browser API
// injected (tests/analytics-client.test.ts drives it with a fake browser).
// ./client.ts builds the real one; components import from there.
//
// - Every event gets a random id (the server stores each id once) and is
//   checked with the shared validateEvent before it is queued; invalid ones
//   are dropped (with a console warning in development).
// - Batching: events wait in memory and are sent every 10 s, as soon as 20
//   are queued, and when the page hides (sendBeacon, fetch keepalive fallback).
//   While the page is hidden, sends are coalesced to the end of the current
//   task (microtask), so visit_end and the dwell events emitted by the same
//   hide go in one beacon; pagehide (unload) sends synchronously.
// - Visit id: random UUID in sessionStorage; a new visit after 30 min idle.
// - Device id: random UUID in localStorage (returning visitors, hearts).
// - visit_start (once per visit, with the visit context) and visit_end (every
//   time the page hides: visible seconds so far, looks seen, last event).
// - GPC / DNT, automated browsers and preview pages: disabled, nothing stored.
// - Storage access is always in try/catch; if blocked, the visit id lives in
//   memory for this page and no device id is sent.
import { campaignFromSearch, deviceClass, normalizePage, visitSource } from './context'
import type { PageVisibilitySource } from './dwell'
import { BATCH_VERSION, MAX_BATCH_EVENTS, validateEvent, type AnalyticsEventType, type PropValue } from './events'
import { isAutomatedClient, isOptedOutClient, type PrivacyNavigator } from './privacy'

export const ANALYTICS_ENDPOINT = '/api/public/events'
export const FLUSH_INTERVAL_MS = 10_000
export const FLUSH_AT_EVENTS = MAX_BATCH_EVENTS
export const VISIT_IDLE_MS = 30 * 60_000
export const MAX_QUEUED_EVENTS = 200
export const VISIT_STORAGE_KEY = 'vyra:analytics:visit'
export const DEVICE_STORAGE_KEY = 'vyra:analytics:device'

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export type AnalyticsEnv = {
  endpoint: string
  /** Wall clock, ms. */
  now(): number
  setTimer(fn: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
  session: StorageLike | null
  local: StorageLike | null
  sendBeacon: ((url: string, body: string) => boolean) | null
  fetch: ((url: string, init: RequestInit) => Promise<unknown>) | null
  randomId(): string
  location: { pathname: string; search: string; host: string }
  referrer: string
  navigator: PrivacyNavigator & { userAgent: string; language?: string; maxTouchPoints?: number }
  windowDoNotTrack?: string | null
  viewport(): { width: number; height: number }
  visibility: PageVisibilitySource
  onPageHide(fn: () => void): void
  /** Run fn at the end of the current task (queueMicrotask in the browser). */
  defer(fn: () => void): void
  /** Development only: report a dropped event. Absent in production. */
  warn?: (message: string) => void
}

/** Props of one event as callers pass them: `slug` and `collection` are lifted onto the event. */
export type TrackProps = { slug?: string; collection?: string } & Record<string, PropValue | undefined>

export type QueuedEvent = {
  id: string
  type: AnalyticsEventType
  at: number
  page: string
  slug?: string
  collection?: string
  props: Record<string, PropValue>
}

export type AnalyticsClient = {
  readonly enabled: boolean
  track(type: AnalyticsEventType, props?: TrackProps): void
  flush(): void
  /** Queued, not yet sent (tests and debugging). */
  pending(): readonly QueuedEvent[]
}

type VisitState = {
  id: string
  /** Last activity (ms), for the 30 min idle rule. */
  last: number
  /** Visible milliseconds so far. */
  activeMs: number
  looks: number
  lastType?: AnalyticsEventType
  lastSlug?: string
}

const DISABLED: AnalyticsClient = Object.freeze({
  enabled: false,
  track() {},
  flush() {},
  pending: () => [],
})

export function disabledAnalyticsClient(): AnalyticsClient {
  return DISABLED
}

function read(storage: StorageLike | null, key: string): string | null {
  try {
    return storage ? storage.getItem(key) : null
  } catch {
    return null
  }
}
function write(storage: StorageLike | null, key: string, value: string): boolean {
  try {
    if (!storage) return false
    storage.setItem(key, value)
    return storage.getItem(key) === value
  } catch {
    return false
  }
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function parseVisit(raw: string | null): VisitState | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<VisitState>
    if (typeof v.id !== 'string' || !UUID_V4.test(v.id)) return null
    if (typeof v.last !== 'number' || typeof v.activeMs !== 'number' || typeof v.looks !== 'number') return null
    return { id: v.id, last: v.last, activeMs: v.activeMs, looks: v.looks, lastType: v.lastType, lastSlug: v.lastSlug }
  } catch {
    return null
  }
}

function isPreviewPage(location: { pathname: string; search: string }): boolean {
  if (/^\/(site\/)?preview(\/|$)/.test(location.pathname)) return true
  try {
    return new URLSearchParams(location.search).has('preview')
  } catch {
    return false
  }
}

export function createAnalyticsClient(env: AnalyticsEnv): AnalyticsClient {
  if (
    isOptedOutClient(env.navigator, { doNotTrack: env.windowDoNotTrack }) ||
    isAutomatedClient(env.navigator) ||
    isPreviewPage(env.location)
  ) {
    return DISABLED
  }

  let queue: QueuedEvent[] = []
  let timer: unknown = null
  let visibleSince: number | null = env.visibility.isVisible() ? env.now() : null
  /** visit_end already sent since the page was last visible. */
  let endedWhileHidden = false

  // Device id: kept if present, else created. Not sent when it can't be stored.
  let returning = false
  let deviceId: string | undefined
  {
    const stored = read(env.local, DEVICE_STORAGE_KEY)
    if (stored && UUID_V4.test(stored)) {
      deviceId = stored
      returning = true
    } else {
      const fresh = env.randomId()
      if (write(env.local, DEVICE_STORAGE_KEY, fresh)) deviceId = fresh
    }
  }

  let visit: VisitState
  const persist = () => {
    write(env.session, VISIT_STORAGE_KEY, JSON.stringify(visit))
  }
  const send = (events: QueuedEvent[]) => {
    const body = JSON.stringify({ v: BATCH_VERSION, visit: visit.id, ...(deviceId ? { device: deviceId } : {}), events })
    try {
      if (env.sendBeacon && env.sendBeacon(env.endpoint, body)) return true
    } catch {
      // fall through to fetch
    }
    if (!env.fetch) return false
    try {
      void env
        .fetch(env.endpoint, {
          method: 'POST',
          body,
          keepalive: true,
          // same-origin: the server must see a staff session cookie to skip staff traffic.
          credentials: 'same-origin',
          headers: { 'content-type': 'text/plain;charset=UTF-8' },
        })
        .catch(() => {})
      return true
    } catch {
      return false
    }
  }

  const clearTimer = () => {
    if (timer !== null) env.clearTimer(timer)
    timer = null
  }

  const flush = () => {
    clearTimer()
    persist()
    while (queue.length > 0) {
      const chunk = queue.slice(0, FLUSH_AT_EVENTS)
      if (!send(chunk)) break // keep them for the next try (bounded below)
      queue = queue.slice(chunk.length)
    }
  }

  /** While hidden: one send at the end of the current task, for everything queued during it. */
  let flushDeferred = false
  const flushSoon = () => {
    if (flushDeferred) return
    flushDeferred = true
    env.defer(() => {
      flushDeferred = false
      flush()
    })
  }

  /** Give the event an id and check it with the shared validator; null (dropped) when invalid. */
  const build = (event: Omit<QueuedEvent, 'id'>): QueuedEvent | null => {
    const full: QueuedEvent = { id: env.randomId(), ...event }
    const problem = validateEvent(full, new Date(env.now()))
    if (typeof problem === 'string') {
      env.warn?.(`[analytics] dropped ${event.type}: ${problem}`)
      return null
    }
    return full
  }

  const push = (event: QueuedEvent) => {
    queue.push(event)
    if (queue.length > MAX_QUEUED_EVENTS) queue = queue.slice(queue.length - MAX_QUEUED_EVENTS)
  }

  const enqueue = (event: QueuedEvent) => {
    push(event)
    if (!env.visibility.isVisible()) {
      flushSoon()
    } else if (queue.length >= FLUSH_AT_EVENTS) {
      flush()
    } else if (timer === null) {
      timer = env.setTimer(() => {
        timer = null
        flush()
      }, FLUSH_INTERVAL_MS)
    }
  }

  const page = () => normalizePage(env.location.pathname)

  const startVisit = () => {
    visit = { id: env.randomId(), last: env.now(), activeMs: 0, looks: 0 }
    visibleSince = env.visibility.isVisible() ? env.now() : null
    const { width, height } = env.viewport()
    const source = visitSource(env.referrer, env.location.search, env.location.host)
    const campaign = campaignFromSearch(env.location.search)
    const lang = env.navigator.language && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8}){0,2}$/.test(env.navigator.language)
      ? env.navigator.language
      : undefined
    const props: Record<string, PropValue> = { ref: source.ref }
    if (source.refDomain) props.refDomain = source.refDomain
    if (campaign) props.campaign = campaign
    props.device = deviceClass({ userAgent: env.navigator.userAgent, maxTouchPoints: env.navigator.maxTouchPoints, width })
    props.vw = Math.max(0, Math.min(20_000, Math.round(width)))
    props.vh = Math.max(0, Math.min(20_000, Math.round(height)))
    if (lang) props.lang = lang
    props.landing = page()
    props.returning = returning
    returning = true // a later visit of this page life is a returning one
    const start = build({ type: 'visit_start', at: env.now(), page: page(), props })
    if (start) enqueue(start)
    persist()
  }

  // Continue the tab's visit (reload, full navigation) or start one.
  {
    const stored = parseVisit(read(env.session, VISIT_STORAGE_KEY))
    if (stored && env.now() - stored.last <= VISIT_IDLE_MS) {
      visit = stored
      visit.last = env.now()
      persist()
    } else {
      startVisit()
    }
  }

  /** A new visit after 30 min without activity. Sends what belongs to the old one first. */
  const rotateIfIdle = () => {
    if (env.now() - visit.last <= VISIT_IDLE_MS) return
    flush()
    startVisit()
  }

  /** visit_end, sent at the end of the task (hide) or at once (sync: pagehide, the page is going away). */
  const endVisit = (sync: boolean) => {
    if (endedWhileHidden) {
      if (sync) flush()
      return
    }
    endedWhileHidden = true
    if (visibleSince !== null) visit.activeMs += Math.max(0, env.now() - visibleSince)
    visibleSince = null
    const props: Record<string, PropValue> = {
      duration: Math.min(86_400, Math.round(visit.activeMs / 100) / 10),
      looks: Math.min(100_000, visit.looks),
    }
    if (visit.lastType) props.last = visit.lastType
    const end = build({ type: 'visit_end', at: env.now(), page: page(), ...(visit.lastSlug ? { slug: visit.lastSlug } : {}), props })
    if (end) push(end)
    if (sync) flush()
    else flushSoon()
  }

  env.visibility.subscribe((visible) => {
    if (!visible) {
      endVisit(false)
    } else {
      endedWhileHidden = false
      if (visibleSince === null) visibleSince = env.now()
      rotateIfIdle()
      visit.last = env.now()
    }
  })
  env.onPageHide(() => endVisit(true))

  return {
    enabled: true,
    track(type, input = {}) {
      try {
        rotateIfIdle()
        const { slug, collection, ...rest } = input
        const props: Record<string, PropValue> = {}
        for (const [k, v] of Object.entries(rest)) if (v !== undefined) props[k] = v
        const event = build({
          type,
          at: env.now(),
          page: page(),
          ...(slug ? { slug } : {}),
          ...(collection ? { collection } : {}),
          props,
        })
        if (!event) return
        visit.last = env.now()
        visit.lastType = type
        if (slug) visit.lastSlug = slug
        if (type === 'look_view') visit.looks += 1
        enqueue(event)
      } catch {
        // Analytics must never break the page.
      }
    },
    flush() {
      try {
        flush()
      } catch {
        // ignore
      }
    },
    pending: () => queue,
  }
}
