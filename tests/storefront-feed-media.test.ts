/**
 * ZP-502: video playback in the feed and on the product page, pure parts
 * (src/lib/storefront/feed-media.ts, and the slide DTO in feed.ts).
 * - A piece's video is the FIRST item of its strip / gallery, then the photos.
 * - Which video plays: only a visible one (>= 60%), never with reduced motion
 *   or Save-Data unless the visitor pressed play, never after a failure.
 * - Preload: "metadata" for the next slide only, "none" otherwise.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  VIDEO_VISIBLE_RATIO,
  autoplayAllowed,
  mediaItems,
  pauseIsVisitors,
  toggledIntent,
  videoLabel,
  videoPreload,
  videoShouldPlay,
  videoSourceAttached,
} from '../src/lib/storefront/feed-media';
import { toFeedItem } from '../src/lib/storefront/feed';
import type { PublicImage, PublicProduct, PublicVideo } from '../src/lib/storefront/dto';

const HEX = 'b'.repeat(32);
const VIDEO: PublicVideo = {
  src: `/api/videos/public/${HEX}.mp4`,
  poster: `/api/videos/public/${HEX}.webp`,
  width: 720,
  height: 1280,
};

function image(alt: string): PublicImage {
  return { url: `/api/images/public/${HEX}.webp`, srcSet: '', alt, width: null, height: null };
}

function product(overrides: Partial<PublicProduct> = {}): PublicProduct {
  return {
    slug: 'lime-pleated-midi-dress',
    name: 'Lime Pleated Midi Dress',
    description: null,
    category: { slug: 'dresses', name: 'Dresses' },
    colours: null,
    sizes: null,
    availability: 'IN_STOCK',
    images: [image('front'), image('back')],
    isNew: false,
    featured: false,
    priceUsd: 65,
    ...overrides,
  };
}

describe('mediaItems (strip / gallery order)', () => {
  test('the video first, then the photos, each photo keeping its photo index', () => {
    const items = mediaItems(['a', 'b'], VIDEO);
    assert.deepStrictEqual(items, [
      { kind: 'video', video: VIDEO },
      { kind: 'image', image: 'a', imageIndex: 0 },
      { kind: 'image', image: 'b', imageIndex: 1 },
    ]);
  });

  test('no video (null, undefined): photos only', () => {
    assert.deepStrictEqual(mediaItems(['a'], null), [{ kind: 'image', image: 'a', imageIndex: 0 }]);
    assert.deepStrictEqual(mediaItems(['a'], undefined), [{ kind: 'image', image: 'a', imageIndex: 0 }]);
  });

  test('a malformed video (no src or poster, bad size) is left out', () => {
    for (const bad of [
      { ...VIDEO, src: '' },
      { ...VIDEO, poster: '' },
      { ...VIDEO, width: 0 },
      { ...VIDEO, height: Number.NaN },
    ]) {
      assert.deepStrictEqual(mediaItems(['a'], bad), [{ kind: 'image', image: 'a', imageIndex: 0 }]);
    }
  });

  test('progress bars count the video', () => {
    assert.strictEqual(mediaItems(['a', 'b', 'c'], VIDEO).length, 4);
  });
});

describe('autoplay', () => {
  test('allowed unless reduced motion or Save-Data', () => {
    assert.strictEqual(autoplayAllowed({ reducedMotion: false, saveData: false }), true);
    assert.strictEqual(autoplayAllowed({ reducedMotion: true, saveData: false }), false);
    assert.strictEqual(autoplayAllowed({ reducedMotion: false, saveData: true }), false);
  });

  test('only a visible video plays (>= 60% on screen)', () => {
    assert.strictEqual(VIDEO_VISIBLE_RATIO, 0.6);
    assert.strictEqual(videoShouldPlay({ visible: true, autoplay: true, intent: 'auto', failed: false }), true);
    assert.strictEqual(videoShouldPlay({ visible: false, autoplay: true, intent: 'auto', failed: false }), false);
  });

  test('reduced motion / Save-Data: never on its own, only after the visitor presses play', () => {
    assert.strictEqual(videoShouldPlay({ visible: true, autoplay: false, intent: 'auto', failed: false }), false);
    assert.strictEqual(videoShouldPlay({ visible: true, autoplay: false, intent: 'play', failed: false }), true);
    // Pressed play, then scrolled away: paused.
    assert.strictEqual(videoShouldPlay({ visible: false, autoplay: false, intent: 'play', failed: false }), false);
  });

  test('paused by the visitor stays paused; a failed video never plays', () => {
    assert.strictEqual(videoShouldPlay({ visible: true, autoplay: true, intent: 'pause', failed: false }), false);
    assert.strictEqual(videoShouldPlay({ visible: true, autoplay: true, intent: 'auto', failed: true }), false);
    assert.strictEqual(videoShouldPlay({ visible: true, autoplay: false, intent: 'play', failed: true }), false);
  });
});

describe('videoPreload', () => {
  test('the current slide loads (it plays), the next one metadata only, the rest none', () => {
    assert.strictEqual(videoPreload({ slideOffset: 0, autoplay: true }), 'auto');
    assert.strictEqual(videoPreload({ slideOffset: 1, autoplay: true }), 'metadata');
    for (const offset of [-1, -3, 2, 5]) assert.strictEqual(videoPreload({ slideOffset: offset, autoplay: true }), 'none');
  });

  test('without autoplay nothing is preloaded (the poster shows until play)', () => {
    for (const offset of [0, 1, 2]) assert.strictEqual(videoPreload({ slideOffset: offset, autoplay: false }), 'none');
  });

  test('current slide not known yet (before the first sync, e.g. a #look- reload): none', () => {
    assert.strictEqual(videoPreload({ slideOffset: null, autoplay: true }), 'none');
  });
});

describe('videoSourceAttached (free decoders far away)', () => {
  test('only the current slide and its neighbours keep their src', () => {
    for (const offset of [-1, 0, 1]) assert.strictEqual(videoSourceAttached(offset), true, String(offset));
    for (const offset of [-3, -2, 2, 7]) assert.strictEqual(videoSourceAttached(offset), false, String(offset));
  });

  test('current slide not known yet: no src (the poster image shows)', () => {
    assert.strictEqual(videoSourceAttached(null), false);
  });
});

describe('pauseIsVisitors', () => {
  test('feed (own button only): an unexpected pause is never taken as the visitor pausing', () => {
    assert.strictEqual(pauseIsVisitors({ nativeControls: false, hidden: false, expected: 'playing' }), false);
  });

  test('gallery (native controls): an unexpected pause while visible is the visitor', () => {
    assert.strictEqual(pauseIsVisitors({ nativeControls: true, hidden: false, expected: 'playing' }), true);
  });

  test('a pause we asked for, or while the page is hidden (background, interruption): not the visitor', () => {
    assert.strictEqual(pauseIsVisitors({ nativeControls: true, hidden: false, expected: 'paused' }), false);
    assert.strictEqual(pauseIsVisitors({ nativeControls: true, hidden: true, expected: 'playing' }), false);
  });
});

describe('toggledIntent (play / pause button)', () => {
  test('decided from what was requested, not from the element (slow networks)', () => {
    assert.strictEqual(toggledIntent(true), 'pause');
    assert.strictEqual(toggledIntent(false), 'play');
  });
});

describe('labels', () => {
  test('"<name> – video"', () => {
    assert.strictEqual(videoLabel('Lime Pleated Midi Dress'), 'Lime Pleated Midi Dress – video');
  });
});

describe('toFeedItem video', () => {
  const ctx = { base: '/site' as const, contacts: { whatsappNumber: null, enquiryTemplate: '', generalEnquiryMessage: '' }, productUrl: () => null };

  test('carries the public video (src, poster, width, height) only', () => {
    const item = toFeedItem(product({ video: VIDEO }), ctx);
    assert.deepStrictEqual(item.video, VIDEO);
    assert.deepStrictEqual(Object.keys(item.video as object).sort(), ['height', 'poster', 'src', 'width']);
  });

  test('extra fields on the DTO video are not copied', () => {
    const item = toFeedItem(product({ video: { ...VIDEO, status: 'READY', videoKey: 'videos/x.mp4' } as unknown as PublicVideo }), ctx);
    assert.deepStrictEqual(Object.keys(item.video as object).sort(), ['height', 'poster', 'src', 'width']);
  });

  test('no video, or a hand-written DTO without the field: null', () => {
    assert.strictEqual(toFeedItem(product({ video: null }), ctx).video, null);
    assert.strictEqual(toFeedItem(product(), ctx).video, null);
  });
});
