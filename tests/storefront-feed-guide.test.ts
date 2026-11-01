/**
 * ZP-509: the first-visit guide on the landing feed, pure parts
 * (src/lib/storefront/feed-guide.ts).
 * - "Seen" in localStorage, read and written without ever throwing; storage
 *   unavailable means the guide shows again.
 * - Never when the page opens on a #look- hash; ?guide=1 replays it (even if
 *   seen) and is removed from the URL.
 * - Steps and copy (touch and desktop), "1 of 3", Next / Got it.
 * - The pulsing ring is placed from the real eye button's rect.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  FEED_GUIDE_PARAM,
  FEED_GUIDE_SEEN_VALUE,
  FEED_GUIDE_STORAGE_KEY,
  advanceGuide,
  guideNextLabel,
  guideProgressLabel,
  guideRing,
  guideSteps,
  isGuideReplay,
  parseGuideSeen,
  readGuideSeen,
  shouldOpenGuide,
  withoutGuideParam,
  writeGuideSeen,
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

describe('guide "seen" storage', () => {
  test('a namespaced localStorage key; only the exact stored value counts as seen', () => {
    assert.strictEqual(FEED_GUIDE_STORAGE_KEY, 'vyra:feed:guide');
    assert.strictEqual(parseGuideSeen(FEED_GUIDE_SEEN_VALUE), true);
    for (const raw of [null, undefined, '', 'true', '1', 'SEEN', ' seen']) assert.strictEqual(parseGuideSeen(raw), false, String(raw));
  });

  test('read: missing or throwing storage is "not seen" (the guide shows again)', () => {
    assert.strictEqual(readGuideSeen(memoryStorage()), false);
    assert.strictEqual(readGuideSeen(memoryStorage({ [FEED_GUIDE_STORAGE_KEY]: FEED_GUIDE_SEEN_VALUE })), true);
    assert.strictEqual(readGuideSeen(null), false);
    assert.strictEqual(readGuideSeen(undefined), false);
    assert.strictEqual(readGuideSeen(throwing), false);
  });

  test('write: stores the value, never throws, reports success', () => {
    const s = memoryStorage();
    assert.strictEqual(writeGuideSeen(s), true);
    assert.strictEqual(s.data.get(FEED_GUIDE_STORAGE_KEY), FEED_GUIDE_SEEN_VALUE);
    assert.strictEqual(readGuideSeen(s), true);
    assert.strictEqual(writeGuideSeen(throwing), false);
    assert.strictEqual(writeGuideSeen(null), false);
  });
});

describe('when the guide opens', () => {
  test('first visit (not seen) without a hash: opens', () => {
    assert.strictEqual(shouldOpenGuide({ seen: false, hash: '', replay: false }), true);
    assert.strictEqual(shouldOpenGuide({ seen: false, hash: '#', replay: false }), true);
  });

  test('already seen: stays closed', () => {
    assert.strictEqual(shouldOpenGuide({ seen: true, hash: '', replay: false }), false);
  });

  test('opened on a #look- hash (shared link, back from a product page): never', () => {
    assert.strictEqual(shouldOpenGuide({ seen: false, hash: '#look-lime-midi', replay: false }), false);
    assert.strictEqual(shouldOpenGuide({ seen: false, hash: '#look-lime-midi', replay: true }), false);
    // Any other hash is not a look: the guide may open.
    assert.strictEqual(shouldOpenGuide({ seen: false, hash: '#top', replay: false }), true);
  });

  test('?guide=1 replays it even when seen', () => {
    assert.strictEqual(shouldOpenGuide({ seen: true, hash: '', replay: true }), true);
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

describe('steps and controls', () => {
  test('three touch steps with the approved copy', () => {
    const steps = guideSteps('touch');
    assert.deepStrictEqual(
      steps.map((s) => [s.title, s.body, s.motion]),
      [
        ['Swipe up', 'Flick up for the next look, down to go back.', 'up'],
        ['Swipe sideways', 'Swipe left and right for more photos of the same piece.', 'side'],
        ['Tap for details', 'Tap the eye for the price and buttons. Tap the photo to open the piece.', 'tap'],
      ],
    );
  });

  test('computers: scroll / keys, arrows and click copy', () => {
    const steps = guideSteps('desktop');
    assert.strictEqual(steps.length, 3);
    assert.strictEqual(steps[0].body, 'Scroll or press ↓ for the next look');
    assert.strictEqual(steps[1].body, 'Click the arrows or swipe for more photos');
    assert.strictEqual(steps[2].title, 'Click for details');
    assert.strictEqual(steps[2].body, 'Click the eye for the price and buttons. Click the photo to open the piece.');
    assert.deepStrictEqual(steps.map((s) => s.motion), ['up', 'side', 'tap']);
  });

  test('"1 of 3", Next until the last step, then Got it', () => {
    assert.strictEqual(guideProgressLabel(0, 3), '1 of 3');
    assert.strictEqual(guideProgressLabel(2, 3), '3 of 3');
    assert.strictEqual(guideNextLabel(0, 3), 'Next');
    assert.strictEqual(guideNextLabel(1, 3), 'Next');
    assert.strictEqual(guideNextLabel(2, 3), 'Got it');
  });

  test('advance: the next step, or null (done) after the last', () => {
    assert.strictEqual(advanceGuide(0, 3), 1);
    assert.strictEqual(advanceGuide(1, 3), 2);
    assert.strictEqual(advanceGuide(2, 3), null);
    assert.strictEqual(advanceGuide(7, 3), null);
  });
});

describe('ring around the eye button', () => {
  test('centred on the eye, relative to the guide frame', () => {
    const ring = guideRing({ left: 334, top: 760, width: 44, height: 44 }, { left: 0, top: 0 }, 60);
    assert.deepStrictEqual(ring, { left: 326, top: 752, size: 60, centerX: 356, centerY: 782 });
  });

  test('a frame offset (the phone column on computers) is subtracted', () => {
    const ring = guideRing({ left: 700, top: 600, width: 44, height: 44 }, { left: 400, top: 16 }, 60);
    assert.deepStrictEqual(ring, { left: 292, top: 576, size: 60, centerX: 322, centerY: 606 });
  });

  test('no eye on screen (rect missing or empty): no ring', () => {
    assert.strictEqual(guideRing(null, { left: 0, top: 0 }, 60), null);
    assert.strictEqual(guideRing({ left: 0, top: 0, width: 0, height: 0 }, { left: 0, top: 0 }, 60), null);
  });
});
