// ZP-493 wave 2: pure helpers that build analytics props for the storefront
// UI (feed, product page). Safe on the client and the server; the events go
// out through track() from @/lib/analytics/client. Every prop here is on the
// allow-list in src/lib/analytics/events.ts; optional props are left out, never
// null. Tested in tests/storefront-tracking.test.ts. See docs/storefront/analytics.md.

import { cleanText, EVENT_SPECS } from '@/lib/analytics/events'

// ------------------------------------------------------------ size / colour

const OPTION_MAX = {
  size: maxOf(EVENT_SPECS.size_select.props.size),
  colour: maxOf(EVENT_SPECS.colour_select.props.colour),
} as const
function maxOf(spec: unknown): number {
  const max = (spec as { max?: unknown }).max
  return typeof max === 'number' ? max : 0
}
/** Same rule as the allow-list's text props (control characters, U+2028/2029). */
const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]')

/**
 * A size / colour chip value as the allow-list accepts it (size <= 24,
 * colour <= 32 characters after cleaning), else undefined. Use it to leave
 * an over-long option out of whatsapp_enquire / restock_request (the event
 * is kept) and to skip size_select / colour_select for it; sending it would
 * make the whole event invalid.
 */
export function allowedOption(kind: 'size' | 'colour', value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const v = cleanText(value)
  return v.length > 0 && v.length <= OPTION_MAX[kind] && !CONTROL.test(v) ? value : undefined
}

export type EnquiryEvent =
  | { type: 'whatsapp_enquire'; props: { screen: 'feed' | 'product'; size?: string; colour?: string } }
  | { type: 'restock_request'; props: { screen: 'feed' | 'product'; size?: string } }

/**
 * The enquiry tap: restock_request for a sold-out piece (size only), else
 * whatsapp_enquire; chosen options that do not fit the allow-list are left out.
 */
export function enquiryEvent(input: {
  soldOut: boolean
  screen: 'feed' | 'product'
  size?: string | null
  colour?: string | null
}): EnquiryEvent {
  const size = allowedOption('size', input.size)
  const colour = allowedOption('colour', input.colour)
  if (input.soldOut) return { type: 'restock_request', props: { screen: input.screen, ...(size ? { size } : {}) } }
  return { type: 'whatsapp_enquire', props: { screen: input.screen, ...(size ? { size } : {}), ...(colour ? { colour } : {}) } }
}

/** The analytics `image` prop: the stored file name (`<32 hex>.webp`) of a public image URL. */
const IMAGE_FILE = /^[a-f0-9]{32}\.webp$/

export function imageFileName(url: string): string | undefined {
  const path = url.split(/[?#]/, 1)[0] ?? ''
  const name = path.slice(path.lastIndexOf('/') + 1)
  return IMAGE_FILE.test(name) ? name : undefined
}

/** The allow-list's photo index range. */
const MAX_PHOTOS = 50

export type PhotoProps = { index: number; of: number; image?: string }

/** photo_view / photo_dwell props for photo `i` (0-based among the photos, a video not counted); null when out of range. */
export function photoProps(images: readonly { src: string }[], i: number): PhotoProps | null {
  const of = Math.min(images.length, MAX_PHOTOS)
  if (!Number.isInteger(i) || i < 0 || i >= of) return null
  const image = imageFileName(images[i].src)
  return image ? { index: i + 1, of, image } : { index: i + 1, of }
}

// ------------------------------------------------------------ video viewing

export type VideoWatchEvent =
  | { type: 'video_start'; props?: undefined }
  | { type: 'video_progress'; props: { pct: 25 | 50 | 75 | 100 } }
  | { type: 'video_replay'; props?: undefined }
  | { type: 'video_seconds'; props: { seconds: number } }

const PROGRESS_STEPS = [25, 50, 75] as const
/** Larger forward / backward steps between two time updates are seeks, not watching. */
const MAX_PLAY_STEP_S = 3
const MAX_VIDEO_SECONDS = 600

/**
 * One viewing of a (looping) video: `video_start` at its first frame, 25 / 50
 * / 75 % once each, 100 % when it reaches the end (a loop or `ended`), a
 * `video_replay` every time it starts over, and the seconds watched
 * (`video_seconds`, media time actually played, capped at 600) when the
 * viewing ends (out of view, unmount) or the page hides (flush).
 * Drive it from the media events: playing -> playing(), timeupdate -> time().
 */
export function createVideoWatch(emit: (event: VideoWatchEvent) => void) {
  let started = false
  let reached = new Set<number>()
  let complete = false
  let last: number | null = null
  let seconds = 0

  const safeEmit = (event: VideoWatchEvent) => {
    try {
      emit(event)
    } catch {
      // Analytics must never break playback.
    }
  }
  const completeOnce = () => {
    if (complete) return
    complete = true
    safeEmit({ type: 'video_progress', props: { pct: 100 } })
  }
  const sendSeconds = () => {
    const s = Math.round(Math.min(seconds, MAX_VIDEO_SECONDS) * 100) / 100
    seconds = 0
    if (s >= 0.1) safeEmit({ type: 'video_seconds', props: { seconds: s } })
  }

  return {
    playing() {
      if (started) return
      started = true
      safeEmit({ type: 'video_start' })
    },
    time(currentTime: number, duration: number) {
      if (!started || !Number.isFinite(currentTime) || !Number.isFinite(duration) || duration <= 0) return
      if (last !== null) {
        const step = currentTime - last
        const looped = step < 0 && last >= duration * 0.8 && currentTime <= duration * 0.2
        if (looped) {
          seconds += Math.max(0, duration - last) + currentTime
          completeOnce()
          safeEmit({ type: 'video_replay' })
        } else if (step > 0 && step <= MAX_PLAY_STEP_S) {
          seconds += step
        }
      }
      last = currentTime
      const pct = (currentTime / duration) * 100
      for (const s of PROGRESS_STEPS) {
        if (pct >= s && !reached.has(s)) {
          reached.add(s)
          safeEmit({ type: 'video_progress', props: { pct: s } })
        }
      }
    },
    /** The video ended (no loop): 100 %. */
    ended() {
      if (started) completeOnce()
    },
    /** The page hides: send the seconds so far, keep the viewing. */
    flush() {
      if (started) sendSeconds()
    },
    /** The viewing is over (out of view, unmount): seconds, then the next play is a new viewing. */
    end() {
      if (!started) return
      sendSeconds()
      started = false
      reached = new Set()
      complete = false
      last = null
    },
  }
}

export type VideoWatch = ReturnType<typeof createVideoWatch>
