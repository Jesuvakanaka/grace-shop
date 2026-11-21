// ZP-1018: the Info view opens every look on the whole photo, details on
// demand. Pure: the panel's mode (photo / details / slim), its reset rules,
// the analytics it sends, which sideways moves count as the visitor's, and the
// right-hand buttons of photo mode. No database, no DOM.
import { describe, test } from 'node:test'
import assert from 'node:assert'
import {
  INFO_MODE_START,
  INFO_MODES,
  infoModeTrack,
  infoPhotoRail,
  infoSlimLine,
  isVisitorPhotoChange,
  nextInfoMode,
  type InfoMode,
  type InfoModeEvent,
} from '../src/lib/storefront/feed-view'
import { TOUR_SETTLE_MS } from '../src/lib/storefront/feed-guide'

const EVENTS: InfoModeEvent[] = ['show', 'hide', 'expand', 'photo-swipe', 'leave-look', 'tour-start']

describe('info view: the panel mode', () => {
  test('every look opens in photo mode', () => {
    assert.strictEqual(INFO_MODE_START, 'photo')
    assert.deepStrictEqual([...INFO_MODES], ['photo', 'details', 'slim'])
  })

  test('Show details opens the full panel (from photo mode or the slim line)', () => {
    assert.strictEqual(nextInfoMode('photo', 'show'), 'details')
    assert.strictEqual(nextInfoMode('slim', 'show'), 'details')
    assert.strictEqual(nextInfoMode('details', 'show'), 'details')
  })

  test('Hide details goes back to the whole photo from the panel or the slim line', () => {
    assert.strictEqual(nextInfoMode('details', 'hide'), 'photo')
    assert.strictEqual(nextInfoMode('slim', 'hide'), 'photo')
    assert.strictEqual(nextInfoMode('photo', 'hide'), 'photo')
  })

  test('a sideways move to another photo shrinks the full panel to the slim line, nothing else', () => {
    assert.strictEqual(nextInfoMode('details', 'photo-swipe'), 'slim')
    assert.strictEqual(nextInfoMode('slim', 'photo-swipe'), 'slim')
    // Photo mode stays photo mode: a swipe never opens details.
    assert.strictEqual(nextInfoMode('photo', 'photo-swipe'), 'photo')
  })

  test('tapping the slim line brings the full panel back; elsewhere it does nothing', () => {
    assert.strictEqual(nextInfoMode('slim', 'expand'), 'details')
    assert.strictEqual(nextInfoMode('details', 'expand'), 'details')
    assert.strictEqual(nextInfoMode('photo', 'expand'), 'photo')
  })

  test('resetting: leaving the look (swipe up / down, collection switch, You may also like) starts it in photo mode again', () => {
    for (const mode of INFO_MODES) assert.strictEqual(nextInfoMode(mode, 'leave-look'), 'photo')
  })

  test('the tour always runs in photo mode (a replay over a look with its panel open closes it)', () => {
    for (const mode of INFO_MODES) assert.strictEqual(nextInfoMode(mode, 'tour-start'), 'photo')
  })

  test('the panel reset: after any session of taps, leaving the look always opens it on the whole photo', () => {
    // Every sequence of up to four events, then leave-look.
    const walk = (mode: InfoMode, depth: number): void => {
      assert.strictEqual(nextInfoMode(mode, 'leave-look'), 'photo')
      if (depth === 0) return
      for (const e of EVENTS) walk(nextInfoMode(mode, e), depth - 1)
    }
    walk(INFO_MODE_START, 4)
  })

  test('the slim line is only ever reached from the full panel', () => {
    for (const mode of INFO_MODES)
      for (const e of EVENTS) {
        const next = nextInfoMode(mode, e)
        if (next === 'slim' && mode !== 'slim') assert.deepStrictEqual([mode, e], ['details', 'photo-swipe'])
      }
  })
})

describe('info view: analytics (details_show / details_hide mean what the eye means in clean view)', () => {
  test('Show details from photo mode sends details_show; Hide details from the panel or slim line sends details_hide', () => {
    assert.strictEqual(infoModeTrack('photo', 'show'), 'details_show')
    assert.strictEqual(infoModeTrack('details', 'hide'), 'details_hide')
    assert.strictEqual(infoModeTrack('slim', 'hide'), 'details_hide')
  })

  test('nothing else is a details event: not the slim line, not a reset, not the tour, not a repeat', () => {
    for (const mode of INFO_MODES)
      for (const e of ['expand', 'photo-swipe', 'leave-look', 'tour-start'] as const) assert.strictEqual(infoModeTrack(mode, e), null, `${mode} ${e}`)
    assert.strictEqual(infoModeTrack('details', 'show'), null)
    assert.strictEqual(infoModeTrack('slim', 'show'), null)
    assert.strictEqual(infoModeTrack('photo', 'hide'), null)
  })
})

describe('info view: which sideways moves are the visitor’s own', () => {
  const settleMs = TOUR_SETTLE_MS
  test('a move during the tour is never the visitor’s (it must not shrink a panel)', () => {
    assert.strictEqual(isVisitorPhotoChange({ touring: true, afterTour: false, sinceTourEndMs: 0, settleMs }), false)
    assert.strictEqual(isVisitorPhotoChange({ touring: true, afterTour: true, sinceTourEndMs: 99_999, settleMs }), false)
  })

  test('just after the tour its own smooth scroll is still settling: not the visitor’s', () => {
    assert.strictEqual(isVisitorPhotoChange({ touring: false, afterTour: true, sinceTourEndMs: 0, settleMs }), false)
    assert.strictEqual(isVisitorPhotoChange({ touring: false, afterTour: true, sinceTourEndMs: TOUR_SETTLE_MS, settleMs }), false)
    assert.strictEqual(isVisitorPhotoChange({ touring: false, afterTour: true, sinceTourEndMs: TOUR_SETTLE_MS + 1, settleMs }), true)
  })

  test('without a tour every move is the visitor’s', () => {
    assert.strictEqual(isVisitorPhotoChange({ touring: false, afterTour: false, sinceTourEndMs: 0, settleMs }), true)
  })
})

describe('info view: photo mode and the slim line', () => {
  test('right-hand buttons in photo mode: WhatsApp (or Visit us without a number), then Call with a phone; no heart, share or corners', () => {
    assert.deepStrictEqual(infoPhotoRail({ enquire: true, call: true }), ['enquire', 'call'])
    assert.deepStrictEqual(infoPhotoRail({ enquire: true, call: false }), ['enquire'])
    assert.deepStrictEqual(infoPhotoRail({ enquire: false, call: true }), ['visit', 'call'])
    assert.deepStrictEqual(infoPhotoRail({ enquire: false, call: false }), ['visit'])
  })

  test('the slim line: "Ask for price · tap for more"', () => {
    assert.strictEqual(infoSlimLine('Ask for price'), 'Ask for price · tap for more')
    assert.strictEqual(infoSlimLine('$65'), 'US$65 · tap for more')
  })
})
