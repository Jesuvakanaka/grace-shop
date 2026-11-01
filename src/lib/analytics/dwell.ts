// ZP-493: honest "time spent" on a look or a photo. Framework-free; the React
// wrappers are in ./client.ts (useDwell, useActiveDwell).
//
// Rules (docs/storefront/analytics.md, "Dwell"):
// - Time counts only while the thing is in view (>= 60% visible) AND the page
//   is visible. Screen lock, app switch or tab switch pause it.
// - What was counted is emitted when it leaves the view, when the page hides
//   and when the tracker stops; then counting starts again from zero.
// - Under 0.5 s is a flick and is not emitted. One dwell is capped at 60 s
//   (a phone left on the table).
// No scroll handlers: in-view comes from IntersectionObserver (or from the
// caller's own state, e.g. the active photo of a carousel).

export const DWELL_MIN_SECONDS = 0.5
export const DWELL_MAX_SECONDS = 60
export const DWELL_VISIBLE_RATIO = 0.6

/** Page visibility, injectable for tests. */
export type PageVisibilitySource = {
  isVisible(): boolean
  /** Calls fn(visible) on every change; returns an unsubscribe function. */
  subscribe(fn: (visible: boolean) => void): () => void
}

/**
 * The document's visibility. "pagehide" also counts as hidden: iOS Safari
 * does not always fire visibilitychange when a tab is closed or replaced.
 * One pair of listeners for all subscribers. Always visible outside a browser.
 */
export const documentVisibility: PageVisibilitySource = (() => {
  const listeners = new Set<(visible: boolean) => void>()
  let installed = false
  let hiddenByPagehide = false
  const isVisible = () =>
    typeof document === 'undefined' ? true : document.visibilityState !== 'hidden' && !hiddenByPagehide
  const notify = () => {
    const v = isVisible()
    for (const fn of [...listeners]) fn(v)
  }
  const install = () => {
    if (installed || typeof document === 'undefined' || typeof window === 'undefined') return
    installed = true
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') hiddenByPagehide = false
      notify()
    })
    window.addEventListener('pagehide', () => {
      hiddenByPagehide = true
      notify()
    })
    window.addEventListener('pageshow', () => {
      if (!hiddenByPagehide) return
      hiddenByPagehide = false
      notify()
    })
  }
  return {
    isVisible,
    subscribe(fn) {
      install()
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
  }
})()

export type DwellTimerOptions = {
  /** Called with seconds (0.5 to 60, 2 decimals) each time a dwell ends. */
  onDwell: (seconds: number) => void
  now?: () => number
  visibility?: PageVisibilitySource
}

export type DwellTimer = {
  /** The thing is (not) in view now. Repeated calls with the same value do nothing. */
  setInView(inView: boolean): void
  /** Emit what was counted so far (if >= 0.5 s) and keep going from zero. */
  flush(): void
  /** Emit what was counted and stop for good. */
  dispose(): void
}

const defaultNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** A dwell counter driven by the caller's in-view state plus page visibility. */
export function createDwellTimer(options: DwellTimerOptions): DwellTimer {
  const now = options.now ?? defaultNow
  const visibility = options.visibility ?? documentVisibility
  let inView = false
  let pageVisible = visibility.isVisible()
  let disposed = false
  let accumulatedMs = 0
  let since: number | null = null // counting since (in view and page visible)

  const counting = () => inView && pageVisible
  const pause = () => {
    if (since !== null) accumulatedMs += Math.max(0, now() - since)
    since = null
  }
  const resume = () => {
    if (since === null && counting()) since = now()
  }
  const emit = () => {
    const seconds = Math.min(accumulatedMs, DWELL_MAX_SECONDS * 1000) / 1000
    accumulatedMs = 0
    if (seconds < DWELL_MIN_SECONDS) return
    try {
      options.onDwell(Math.round(seconds * 100) / 100)
    } catch {
      // Analytics must never break the page.
    }
  }

  const unsubscribe = visibility.subscribe((visible) => {
    if (disposed || visible === pageVisible) return
    if (!visible) {
      pause()
      pageVisible = false
      emit()
    } else {
      pageVisible = true
      resume()
    }
  })

  return {
    setInView(next) {
      if (disposed || next === inView) return
      if (!next) {
        pause()
        inView = false
        emit()
      } else {
        inView = true
        resume()
      }
    },
    flush() {
      if (disposed) return
      pause()
      emit()
      resume()
    },
    dispose() {
      if (disposed) return
      pause()
      emit()
      disposed = true
      unsubscribe()
    },
  }
}

export type DwellTrackerOptions = DwellTimerOptions & {
  /** Visible share that counts as "in view" (default 0.6). */
  threshold?: number
  /** Scroll container to measure against (e.g. a photo carousel); default the viewport. */
  root?: Element | null
  /** Injectable for tests; null = unavailable (the tracker then does nothing). */
  IntersectionObserver?: typeof IntersectionObserver | null
}

export type DwellTracker = { stop(): void }

/** Dwell of one element, in view = at least `threshold` of it visible. */
export function createDwellTracker(element: Element, options: DwellTrackerOptions): DwellTracker {
  const IO =
    options.IntersectionObserver !== undefined
      ? options.IntersectionObserver
      : typeof IntersectionObserver !== 'undefined'
        ? IntersectionObserver
        : null
  if (!IO) return { stop() {} }
  const threshold = options.threshold ?? DWELL_VISIBLE_RATIO
  const timer = createDwellTimer(options)
  const observer = new IO(
    (entries) => {
      const entry = entries[entries.length - 1]
      if (!entry) return
      // A hair of tolerance: browsers report 0.5999 for an exactly-60% box.
      timer.setInView(entry.isIntersecting && entry.intersectionRatio >= threshold - 0.001)
    },
    { threshold: [0, threshold, 1], root: options.root ?? null },
  )
  observer.observe(element)
  return {
    stop() {
      observer.disconnect()
      timer.dispose()
    },
  }
}
