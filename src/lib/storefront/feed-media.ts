// ZP-502: product video playback in the feed and on the product page, pure
// parts. Client safe.
//
// A piece's video (ZP-501, PublicProduct.video) is the first item of its
// sideways strip in the feed and of the product page gallery, then the
// photos. Muted, looped and inline; only a video that is on screen (at least
// 60%, IntersectionObserver) plays, and never on its own with
// prefers-reduced-motion or Save-Data (poster with a play button then).
// Components: src/components/storefront/video/*. Tested in
// tests/storefront-feed-media.test.ts. See docs/storefront/videos.md.
import type { PublicVideo } from './dto'

/** A video plays while at least this share of it is on screen. */
export const VIDEO_VISIBLE_RATIO = 0.6
/** Asked to play but no frame after this long (slow network): back to the poster. */
export const VIDEO_STALL_MS = 8000

export type MediaVideo = PublicVideo

export type MediaItem<I> = { kind: 'video'; video: MediaVideo } | { kind: 'image'; image: I; imageIndex: number }

const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0

/** A video the page can show: both URLs and a real size. */
export function isPlayableVideo(v: MediaVideo | null | undefined): v is MediaVideo {
  return !!v && typeof v.src === 'string' && v.src !== '' && typeof v.poster === 'string' && v.poster !== '' && positive(v.width) && positive(v.height)
}

/** Only the four public fields (never anything else a DTO might carry). */
export function pickVideo(v: MediaVideo | null | undefined): MediaVideo | null {
  return isPlayableVideo(v) ? { src: v.src, poster: v.poster, width: v.width, height: v.height } : null
}

/** The strip / gallery: the video first (when there is one), then the photos. */
export function mediaItems<I>(images: readonly I[], video: MediaVideo | null | undefined): MediaItem<I>[] {
  const photos = images.map((image, imageIndex): MediaItem<I> => ({ kind: 'image', image, imageIndex }))
  const v = pickVideo(video)
  return v ? [{ kind: 'video', video: v }, ...photos] : photos
}

/** Videos may start on their own unless the visitor asked for less motion or less data. */
export function autoplayAllowed(input: { reducedMotion: boolean; saveData: boolean }): boolean {
  return !input.reducedMotion && !input.saveData
}

/**
 * "auto": no choice yet (autoplay decides); "play" / "pause": the visitor
 * pressed the button.
 */
export type PlayIntent = 'auto' | 'play' | 'pause'

export function videoShouldPlay(input: { visible: boolean; autoplay: boolean; intent: PlayIntent; failed: boolean }): boolean {
  if (input.failed || !input.visible || input.intent === 'pause') return false
  return input.intent === 'play' || input.autoplay
}

/**
 * `preload` for a feed video. `slideOffset`: its slide's index minus the
 * current slide's. The current slide loads (it is playing), the next one
 * fetches metadata only, every other slide nothing; without autoplay nothing
 * is fetched until the visitor presses play.
 */
export function videoPreload(input: { slideOffset: number | null; autoplay: boolean }): 'auto' | 'metadata' | 'none' {
  // null: the current slide is not known yet (before the first sync).
  if (!input.autoplay || input.slideOffset === null) return 'none'
  if (input.slideOffset === 0) return 'auto'
  if (input.slideOffset === 1) return 'metadata'
  return 'none'
}

/**
 * Does a feed video keep its `src`? Only on the current slide and its
 * neighbours; further away the source is removed (and the element reset) to
 * free the decoder and buffers (iOS limits active media elements). Null:
 * the current slide is not known yet, so none has one (the poster <img> shows).
 */
export function videoSourceAttached(slideOffset: number | null): boolean {
  return slideOffset !== null && Math.abs(slideOffset) <= 1
}

/**
 * Was a `pause` event the visitor's own choice? Only with native controls
 * (product gallery), only when we did not ask for it, and never while the
 * page is hidden (background tab, iOS app switch, media interruption: the
 * browser paused it, and it resumes when the page is back).
 */
export function pauseIsVisitors(input: { nativeControls: boolean; hidden: boolean; expected: 'playing' | 'paused' }): boolean {
  return input.nativeControls && !input.hidden && input.expected === 'playing'
}

/** The play / pause button, from what was requested (not the element's state, which lags on slow networks). */
export function toggledIntent(requested: boolean): 'play' | 'pause' {
  return requested ? 'pause' : 'play'
}

/** The video's accessible name: "<name> – video". */
export function videoLabel(name: string): string {
  return `${name} – video`
}
