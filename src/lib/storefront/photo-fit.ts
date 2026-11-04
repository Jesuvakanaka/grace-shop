// ZP-515: how a feed photo fills its frame, pure parts. Client safe.
//
// The feed fills the screen (object-fit: cover), which trims what does not
// fit. That is fine for the usual portrait photo, but a landscape photo on a
// phone keeps only its middle third, and a photo narrower than the frame
// (tablet / computer 9:16 column) loses the head and feet. Those photos are
// shown whole (contain) over a blurred copy of themselves instead.
// Component: src/components/storefront/feed/FeedPhoto.tsx. Tested in
// tests/storefront-photo-fit.test.ts.

export type PhotoFit = 'cover' | 'contain'
export type Size = { width: number; height: number }

/** Cover is kept while it shows at least this share of the photo's width (sides trimmed)... */
export const MIN_VISIBLE_WIDTH = 0.5
/** ...and at least this share of its height (top and bottom trimmed: heads and feet). */
export const MIN_VISIBLE_HEIGHT = 0.95

const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0

/** Cover unless it would cut too much of this photo in this frame; cover when a size is unknown. */
export function photoFit(photo: Size, frame: Size): PhotoFit {
  if (!positive(photo.width) || !positive(photo.height) || !positive(frame.width) || !positive(frame.height)) return 'cover'
  const photoRatio = photo.width / photo.height
  const frameRatio = frame.width / frame.height
  if (photoRatio >= frameRatio) return frameRatio / photoRatio < MIN_VISIBLE_WIDTH ? 'contain' : 'cover'
  return photoRatio / frameRatio < MIN_VISIBLE_HEIGHT ? 'contain' : 'cover'
}
