// ZP-518: the navigation pop-up on the landing feed, and the first-visit photo
// tour, pure parts. Client safe.
//
// The pop-up lists how to get around the site. It opens on every landing until
// the visitor chooses "Don't show this again" (localStorage), and always from
// the menu with `?guide=1`. The UI is
// src/components/storefront/feed/FeedGuide.tsx. Tested in
// tests/storefront-feed-guide.test.ts. See docs/storefront/feed.md.
import { parseLookHash } from './feed'

/** localStorage key: the visitor chose "Don't show this again". A new key, so ZP-509's "seen" does not hide it. */
export const FEED_GUIDE_STORAGE_KEY = 'vyra:feed:help'
export const FEED_GUIDE_HIDDEN_VALUE = 'hidden'
/** `/?guide=1` opens the pop-up (the menu's "How to use VYRA", ZP-509 reads and removes it). */
export const FEED_GUIDE_PARAM = 'guide'

type ReadableStorage = { getItem(key: string): string | null }
type WritableStorage = { setItem(key: string, value: string): void }

/** Never throws; storage missing or blocked reads as false. Only the exact value counts. */
function readFlag(storage: ReadableStorage | null | undefined, key: string, value: string): boolean {
  try {
    return storage?.getItem(key) === value
  } catch {
    return false
  }
}

/** Never throws; false when the value could not be stored. */
function writeFlag(storage: WritableStorage | null | undefined, key: string, value: string): boolean {
  if (!storage) return false
  try {
    storage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

/** Storage missing or blocked: not hidden, so the pop-up shows again. */
export function readGuideHidden(storage: ReadableStorage | null | undefined): boolean {
  return readFlag(storage, FEED_GUIDE_STORAGE_KEY, FEED_GUIDE_HIDDEN_VALUE)
}

export function writeGuideHidden(storage: WritableStorage | null | undefined): boolean {
  return writeFlag(storage, FEED_GUIDE_STORAGE_KEY, FEED_GUIDE_HIDDEN_VALUE)
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
 * look, or coming back mid-browse). Otherwise from the menu always; on a
 * landing unless the visitor chose not to see it again.
 */
export function shouldOpenGuide(input: { hidden: boolean; hash: string; replay: boolean }): boolean {
  if (parseLookHash(input.hash) !== null) return false
  return input.replay || !input.hidden
}

// ------------------------------------------------------------------- tips

export const GUIDE_TITLE = 'How to use VYRA'

export type GuideIcon = 'up' | 'side' | 'tap' | 'eye' | 'contact' | 'menu'
export type GuideTip = { title: string; body: string; icon: GuideIcon }
/** "touch": phones and tablets; "desktop": a fine pointer on a wide screen. */
export type GuideLayout = 'touch' | 'desktop'

const CONTACT_TIP: GuideTip = { title: 'WhatsApp or Call', body: 'Ask about a piece or call the shop.', icon: 'contact' }
const MENU_TIP: GuideTip = { title: 'Open the menu', body: 'Browse collections, read about VYRA and find the shop.', icon: 'menu' }

export function guideTips(layout: GuideLayout): GuideTip[] {
  if (layout === 'desktop') {
    return [
      { title: 'Scroll or press ↓', body: 'See the next look. Press ↑ to go back.', icon: 'up' },
      { title: 'Click the arrows', body: 'See more photos of the same piece.', icon: 'side' },
      { title: 'Click the photo', body: 'See sizes, fabric, how to buy and reviews.', icon: 'tap' },
      { title: 'Click the eye', body: 'Show the name, price and share button.', icon: 'eye' },
      CONTACT_TIP,
      MENU_TIP,
    ]
  }
  return [
    { title: 'Swipe up', body: 'See the next look. Swipe down to go back.', icon: 'up' },
    { title: 'Swipe sideways', body: 'See more photos of the same piece.', icon: 'side' },
    { title: 'Tap the photo', body: 'See sizes, fabric, how to buy and reviews.', icon: 'tap' },
    { title: 'Tap the eye', body: 'Show the name, price and share button.', icon: 'eye' },
    CONTACT_TIP,
    MENU_TIP,
  ]
}

// ------------------------------------------------------------------- tour

// The first-visit photo tour: after the pop-up, the look on screen slides
// sideways through all its photos once, then back to the first, so visitors
// learn the strip swipes. Any touch, click, scroll or key stops it. Its photo
// views are not tracked (photo_view index >= 2 is the ranking's "swiped"
// signal). The timers are in FeedSlide, the decision in FlipFeed.

/** localStorage key: the tour ran, or was stopped, in this browser. */
export const FEED_TOUR_STORAGE_KEY = 'vyra:feed:tour'
export const FEED_TOUR_SEEN_VALUE = 'seen'
/** After the pop-up closes (or the page settles) before the tour starts. */
export const TOUR_START_DELAY_MS = 800
/** After the tour ends, scrolling this soon is still its own smooth scroll settling, not the visitor. */
export const TOUR_SETTLE_MS = 600
const TOUR_TOTAL_MS = 10_000
const TOUR_MIN_PHOTO_MS = 900
const TOUR_MAX_PHOTO_MS = 1500

/** Storage missing or blocked: not seen. */
export function readTourSeen(storage: ReadableStorage | null | undefined): boolean {
  return readFlag(storage, FEED_TOUR_STORAGE_KEY, FEED_TOUR_SEEN_VALUE)
}

export function writeTourSeen(storage: WritableStorage | null | undefined): boolean {
  return writeFlag(storage, FEED_TOUR_STORAGE_KEY, FEED_TOUR_SEEN_VALUE)
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
