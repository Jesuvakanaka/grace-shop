// ZP-509: the first-visit guide on the landing feed, pure parts. Client safe.
//
// Three steps on a see-through dark layer over the first look (Swipe up,
// Swipe sideways, Tap for details), shown once per browser ("seen" in
// localStorage) and replayed from the menu with `?guide=1`. The UI is
// src/components/storefront/feed/FeedGuide.tsx. Tested in
// tests/storefront-feed-guide.test.ts. See docs/storefront/feed.md.
import { parseLookHash } from './feed'

/** localStorage key: the guide was finished or skipped in this browser. */
export const FEED_GUIDE_STORAGE_KEY = 'vyra:feed:guide'
export const FEED_GUIDE_SEEN_VALUE = 'seen'
/** `/?guide=1` opens the guide again (the menu's "How to use VYRA" row). */
export const FEED_GUIDE_PARAM = 'guide'

type ReadableStorage = { getItem(key: string): string | null }
type WritableStorage = { setItem(key: string, value: string): void }

/** Only exactly "seen" counts. */
export function parseGuideSeen(raw: string | null | undefined): boolean {
  return raw === FEED_GUIDE_SEEN_VALUE
}

/** Never throws: storage missing or blocked reads as "not seen", so the guide shows again. */
export function readGuideSeen(storage: ReadableStorage | null | undefined): boolean {
  try {
    return parseGuideSeen(storage?.getItem(FEED_GUIDE_STORAGE_KEY))
  } catch {
    return false
  }
}

/** Never throws; false when the value could not be stored. */
export function writeGuideSeen(storage: WritableStorage | null | undefined): boolean {
  if (!storage) return false
  try {
    storage.setItem(FEED_GUIDE_STORAGE_KEY, FEED_GUIDE_SEEN_VALUE)
    return true
  } catch {
    return false
  }
}

/** `?guide=1` (exactly "1"). */
export function isGuideReplay(search: string): boolean {
  return new URLSearchParams(search).get(FEED_GUIDE_PARAM) === '1'
}

/** The same URL without `guide=` (other parameters and the hash kept). */
export function withoutGuideParam(pathname: string, search: string, hash: string): string {
  const params = new URLSearchParams(search)
  params.delete(FEED_GUIDE_PARAM)
  const query = params.toString()
  return `${pathname}${query ? `?${query}` : ''}${hash && hash !== '#' ? hash : ''}`
}

/**
 * Open on mount? Never when the page opened on a `#look-<slug>` (a shared
 * look, or back from a product page: the visitor is mid-browse). Otherwise
 * a replay always opens; a first visit opens when not seen.
 */
export function shouldOpenGuide(input: { seen: boolean; hash: string; replay: boolean }): boolean {
  if (parseLookHash(input.hash) !== null) return false
  return input.replay || !input.seen
}

// ------------------------------------------------------------------ steps

export type GuideMotion = 'up' | 'side' | 'tap'
export type GuideStep = { title: string; body: string; motion: GuideMotion }
/** "touch": phones and tablets; "desktop": a fine pointer on a wide screen. */
export type GuideLayout = 'touch' | 'desktop'

const TAP_STEP: GuideStep = {
  title: 'Tap for details',
  body: 'Tap the eye for the price and buttons. Tap the photo to open the piece.',
  motion: 'tap',
}

export function guideSteps(layout: GuideLayout): GuideStep[] {
  if (layout === 'desktop') {
    return [
      { title: 'Next look', body: 'Scroll or press ↓ for the next look', motion: 'up' },
      { title: 'More photos', body: 'Click the arrows or swipe for more photos', motion: 'side' },
      {
        title: 'Click for details',
        body: 'Click the eye for the price and buttons. Click the photo to open the piece.',
        motion: 'tap',
      },
    ]
  }
  return [
    { title: 'Swipe up', body: 'Flick up for the next look, down to go back.', motion: 'up' },
    { title: 'Swipe sideways', body: 'Swipe left and right for more photos of the same piece.', motion: 'side' },
    TAP_STEP,
  ]
}

/** "1 of 3". */
export function guideProgressLabel(step: number, count: number): string {
  return `${step + 1} of ${count}`
}

export function guideNextLabel(step: number, count: number): 'Next' | 'Got it' {
  return step >= count - 1 ? 'Got it' : 'Next'
}

/** The next step, or null when the guide is done. */
export function advanceGuide(step: number, count: number): number | null {
  return step + 1 < count ? step + 1 : null
}

// ------------------------------------------------------------------- ring

export type Rect = { left: number; top: number; width: number; height: number }
export type GuideRing = { left: number; top: number; size: number; centerX: number; centerY: number }

/**
 * The pulsing ring of step 3, centred on the real eye button (`eye`, a
 * viewport rect) in the guide frame's coordinates (`frame`: its viewport
 * offset). Null when the eye is not on screen.
 */
export function guideRing(eye: Rect | null | undefined, frame: { left: number; top: number }, size: number): GuideRing | null {
  if (!eye || !(eye.width > 0) || !(eye.height > 0)) return null
  const centerX = eye.left + eye.width / 2 - frame.left
  const centerY = eye.top + eye.height / 2 - frame.top
  return { left: centerX - size / 2, top: centerY - size / 2, size, centerX, centerY }
}

// ------------------------------------------------------------------- tour

// The first-visit photo tour: after the guide, the look on screen slides
// sideways through all its photos once, then back to the first, so visitors
// learn the strip swipes. Any touch, click, scroll or key stops it. Its photo
// views are not tracked (photo_view index >= 2 is the ranking's "swiped"
// signal). The timers are in FeedSlide, the decision in FlipFeed.

/** localStorage key: the tour ran, or was stopped, in this browser. */
export const FEED_TOUR_STORAGE_KEY = 'vyra:feed:tour'
/** After the guide closes (or the page settles) before the tour starts. */
export const TOUR_START_DELAY_MS = 800
const TOUR_TOTAL_MS = 10_000
const TOUR_MIN_PHOTO_MS = 900
const TOUR_MAX_PHOTO_MS = 1500

/** Never throws: storage missing or blocked reads as "not seen". */
export function readTourSeen(storage: ReadableStorage | null | undefined): boolean {
  try {
    return parseGuideSeen(storage?.getItem(FEED_TOUR_STORAGE_KEY))
  } catch {
    return false
  }
}

/** Never throws; false when the value could not be stored. */
export function writeTourSeen(storage: WritableStorage | null | undefined): boolean {
  if (!storage) return false
  try {
    storage.setItem(FEED_TOUR_STORAGE_KEY, FEED_GUIDE_SEEN_VALUE)
    return true
  } catch {
    return false
  }
}

/** Never with reduced motion; otherwise on a replay ("How to use VYRA") or when not seen. */
export function shouldRunTour(input: { seen: boolean; replay: boolean; reducedMotion: boolean }): boolean {
  if (input.reducedMotion) return false
  return input.replay || !input.seen
}

/** How long each photo stays: about 10 s for the whole look, kept readable when it has many photos. */
export function tourPhotoMs(count: number): number {
  if (!(count > 0)) return TOUR_MAX_PHOTO_MS
  return Math.min(TOUR_MAX_PHOTO_MS, Math.max(TOUR_MIN_PHOTO_MS, Math.round(TOUR_TOTAL_MS / count)))
}
