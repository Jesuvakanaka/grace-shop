/**
 * ZP-518: the navigation pop-up on the landing feed, and the first-visit photo
 * tour, pure parts (src/lib/storefront/feed-guide.ts).
 * - Opens on every landing until "Don't show this again" (localStorage); storage
 *   unavailable means it shows again. ZP-509's "seen" does not hide it.
 * - Never when the page opens on a #look- hash; ?guide=1 opens it even if hidden
 *   and is removed from the URL.
 * - The tips (touch and desktop).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  FEED_GUIDE_HIDDEN_VALUE,
  FEED_GUIDE_PARAM,
  FEED_GUIDE_STORAGE_KEY,
  FEED_TOUR_SEEN_VALUE,
  FEED_TOUR_STORAGE_KEY,
  GUIDE_TITLE,
  guideTips,
  isGuideReplay,
  readGuideHidden,
  readTourSeen,
  shouldOpenGuide,
  shouldRunTour,
  tourPhotoMs,
  withoutGuideParam,
  writeGuideHidden,
  writeTourSeen,
} from '../src/lib/storefront/feed-guide';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => (data.has(k) ? (data.get(k) as string) : null),
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

const throwing = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
};

describe('"Don\'t show this again" storage', () => {
  test('a new key: the old guide\'s "seen" does not hide the pop-up', () => {
    assert.strictEqual(FEED_GUIDE_STORAGE_KEY, 'vyra:feed:help');
    assert.strictEqual(readGuideHidden(memoryStorage({ 'vyra:feed:guide': 'seen' })), false);
  });

  test('read: only the exact value hides it; missing or throwing storage does not', () => {
    assert.strictEqual(readGuideHidden(memoryStorage({ [FEED_GUIDE_STORAGE_KEY]: FEED_GUIDE_HIDDEN_VALUE })), true);
    assert.strictEqual(readGuideHidden(memoryStorage()), false);
    assert.strictEqual(readGuideHidden(memoryStorage({ [FEED_GUIDE_STORAGE_KEY]: 'true' })), false);
    assert.strictEqual(readGuideHidden(null), false);
    assert.strictEqual(readGuideHidden(undefined), false);
    assert.strictEqual(readGuideHidden(throwing), false);
  });

  test('write: stores the value, never throws, reports success', () => {
    const s = memoryStorage();
    assert.strictEqual(writeGuideHidden(s), true);
    assert.strictEqual(s.data.get(FEED_GUIDE_STORAGE_KEY), FEED_GUIDE_HIDDEN_VALUE);
    assert.strictEqual(readGuideHidden(s), true);
    assert.strictEqual(writeGuideHidden(throwing), false);
    assert.strictEqual(writeGuideHidden(null), false);
  });
});

describe('when the pop-up opens', () => {
  test('a landing without a hash: opens, every time, until hidden', () => {
    assert.strictEqual(shouldOpenGuide({ hidden: false, hash: '', replay: false }), true);
    assert.strictEqual(shouldOpenGuide({ hidden: false, hash: '#', replay: false }), true);
    assert.strictEqual(shouldOpenGuide({ hidden: true, hash: '', replay: false }), false);
  });

  test('opened on a #look- hash (a shared link): never', () => {
    assert.strictEqual(shouldOpenGuide({ hidden: false, hash: '#look-lime-midi', replay: false }), false);
    assert.strictEqual(shouldOpenGuide({ hidden: false, hash: '#look-lime-midi', replay: true }), false);
    // Any other hash is not a look: it may open.
    assert.strictEqual(shouldOpenGuide({ hidden: false, hash: '#top', replay: false }), true);
  });

  test('from the menu (?guide=1): opens even when hidden', () => {
    assert.strictEqual(shouldOpenGuide({ hidden: true, hash: '', replay: true }), true);
  });
});

describe('replay parameter', () => {
  test('only ?guide=1 is a replay', () => {
    assert.strictEqual(FEED_GUIDE_PARAM, 'guide');
    assert.strictEqual(isGuideReplay('?guide=1'), true);
    assert.strictEqual(isGuideReplay('guide=1'), true);
    assert.strictEqual(isGuideReplay('?c=dresses&guide=1'), true);
    for (const s of ['', '?', '?guide=0', '?guide=', '?guide=true', '?c=dresses']) assert.strictEqual(isGuideReplay(s), false, s);
  });

  test('removing it keeps the other parameters and the hash', () => {
    assert.strictEqual(withoutGuideParam('/site', '?guide=1', ''), '/site');
    assert.strictEqual(withoutGuideParam('/', '?c=dresses&guide=1', ''), '/?c=dresses');
    assert.strictEqual(withoutGuideParam('/', '?guide=1&c=dresses', '#look-a'), '/?c=dresses#look-a');
    assert.strictEqual(withoutGuideParam('/site', '', ''), '/site');
  });
});

describe('the tips', () => {
  test('the title matches the menu row', () => {
    assert.strictEqual(GUIDE_TITLE, 'How to use VYRA');
  });

  test('phones: swipes and taps', () => {
    assert.deepStrictEqual(
      guideTips('touch').map((t) => t.title),
      ['Swipe up', 'Swipe sideways', 'Tap the photo', 'Tap the eye', 'WhatsApp or Call', 'Open the menu'],
    );
  });

  test('computers: scroll, keys and clicks, the same things in the same order', () => {
    const tips = guideTips('desktop');
    assert.deepStrictEqual(
      tips.map((t) => t.title),
      ['Scroll or press ↓', 'Click the arrows', 'Click the photo', 'Click the eye', 'WhatsApp or Call', 'Open the menu'],
    );
    assert.deepStrictEqual(tips.map((t) => t.icon), guideTips('touch').map((t) => t.icon));
  });
});

describe('first-visit photo tour', () => {
  test('runs once: seen is stored under its own key', () => {
    const storage = memoryStorage();
    assert.strictEqual(readTourSeen(storage), false);
    assert.strictEqual(writeTourSeen(storage), true);
    assert.strictEqual(readTourSeen(storage), true);
    assert.strictEqual(storage.getItem(FEED_TOUR_STORAGE_KEY), FEED_TOUR_SEEN_VALUE);
    assert.strictEqual(readGuideHidden(storage), false);
  });
  test('blocked storage reads as not seen and never throws', () => {
    const blocked = {
      getItem(): string | null {
        throw new Error('blocked');
      },
      setItem(): void {
        throw new Error('blocked');
      },
    };
    assert.strictEqual(readTourSeen(blocked), false);
    assert.strictEqual(writeTourSeen(blocked), false);
    assert.strictEqual(readTourSeen(null), false);
    assert.strictEqual(writeTourSeen(null), false);
  });
  test('when it runs: not seen or a replay, never with reduced motion', () => {
    assert.strictEqual(shouldRunTour({ seen: false, replay: false, reducedMotion: false }), true);
    assert.strictEqual(shouldRunTour({ seen: true, replay: false, reducedMotion: false }), false);
    assert.strictEqual(shouldRunTour({ seen: true, replay: true, reducedMotion: false }), true);
    assert.strictEqual(shouldRunTour({ seen: false, replay: true, reducedMotion: true }), false);
  });
  test('each photo stays long enough to see, and a big look stays short', () => {
    assert.strictEqual(tourPhotoMs(3), 1500);
    assert.strictEqual(tourPhotoMs(8), 1250);
    assert.strictEqual(tourPhotoMs(16), 900);
    assert.strictEqual(tourPhotoMs(0), 1500);
  });
});
