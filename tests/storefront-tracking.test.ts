/**
 * ZP-493 wave 2: the storefront's event prop builders (src/lib/storefront/tracking.ts).
 * - `image` is the stored file name (<32 hex>.webp), never a URL.
 * - photo props are 1-based among the photos (a video first does not count).
 * (ZP-512: product_open's `from` helper went with the product page.)
 * - video viewing: start, 25/50/75/100 once per viewing, replays on loop, seconds watched.
 * Every built event must pass the shared allow-list (validateEvent).
 */
import { describe, test } from 'node:test'
import assert from 'node:assert'
import { randomUUID } from 'node:crypto'
import { validateEvent } from '../src/lib/analytics/events'
import {
  allowedOption,
  enquiryEvent,
  createVideoWatch,
  imageFileName,
  photoProps,
  type VideoWatchEvent,
} from '../src/lib/storefront/tracking'

const HEX = '0123456789abcdef0123456789abcdef'

function valid(type: string, slug: string | undefined, props: Record<string, unknown>) {
  const raw = { id: randomUUID(), type, at: Date.now(), page: '/', ...(slug ? { slug } : {}), props }
  const result = validateEvent(raw, new Date())
  return typeof result === 'string' ? result : null
}

describe('size / colour that do not fit the allow-list', () => {
  const longSize = 'UK 10 / EU 38 / US 6 (fitted)' // 29 > 24
  const longColour = 'Olive green with ivory piping and gold' // 38 > 32

  test('allowedOption: kept as the chip shows it when it fits, undefined otherwise', () => {
    assert.strictEqual(allowedOption('size', 'UK 10'), 'UK 10')
    assert.strictEqual(allowedOption('size', 'x'.repeat(24)), 'x'.repeat(24))
    assert.strictEqual(allowedOption('size', 'x'.repeat(25)), undefined)
    assert.strictEqual(allowedOption('size', longSize), undefined)
    assert.strictEqual(allowedOption('colour', 'x'.repeat(32)), 'x'.repeat(32))
    assert.strictEqual(allowedOption('colour', longColour), undefined)
    assert.strictEqual(allowedOption('colour', 'Bad\u0007'), undefined)
    assert.strictEqual(allowedOption('size', null), undefined)
    assert.strictEqual(allowedOption('size', '   '), undefined)
    // Zero-width characters do not count towards the length (as on the server).
    assert.strictEqual(allowedOption('size', `${'x'.repeat(24)}​`), `${'x'.repeat(24)}​`)
  })

  test('a fitting option makes a valid size_select / colour_select; an over-long one would not', () => {
    assert.strictEqual(valid('size_select', 'linen-dress', { size: 'UK 10' }), null)
    assert.notStrictEqual(valid('size_select', 'linen-dress', { size: longSize }), null)
    assert.notStrictEqual(valid('colour_select', 'linen-dress', { colour: longColour }), null)
  })

  test('enquiry: the event is kept, an over-long size / colour left out', () => {
    const e = enquiryEvent({ soldOut: false, screen: 'product', size: longSize, colour: longColour })
    assert.deepStrictEqual(e, { type: 'whatsapp_enquire', props: { screen: 'product' } })
    assert.strictEqual(valid(e.type, 'linen-dress', e.props), null)
    const ok = enquiryEvent({ soldOut: false, screen: 'product', size: 'M', colour: longColour })
    assert.deepStrictEqual(ok.props, { screen: 'product', size: 'M' })
    assert.strictEqual(valid(ok.type, 'linen-dress', ok.props), null)
  })

  test('sold out: restock_request with the size only (no colour prop on that event)', () => {
    const e = enquiryEvent({ soldOut: true, screen: 'product', size: 'M', colour: 'Olive' })
    assert.deepStrictEqual(e, { type: 'restock_request', props: { screen: 'product', size: 'M' } })
    assert.strictEqual(valid(e.type, 'linen-dress', e.props), null)
    const long = enquiryEvent({ soldOut: true, screen: 'feed', size: longSize })
    assert.deepStrictEqual(long.props, { screen: 'feed' })
    assert.strictEqual(valid(long.type, 'linen-dress', long.props), null)
  })
})

describe('image file name', () => {
  test('the last path segment of a public image URL', () => {
    assert.strictEqual(imageFileName(`/api/images/public/${HEX}.webp`), `${HEX}.webp`)
    assert.strictEqual(imageFileName(`/api/images/public/${HEX}.webp?w=828`), `${HEX}.webp`)
    assert.strictEqual(imageFileName(`https://shop.example/api/images/public/${HEX}.webp?w=320#x`), `${HEX}.webp`)
  })
  test('anything else: left out (undefined), never sent as null', () => {
    assert.strictEqual(imageFileName('/_blob/abc'), undefined)
    assert.strictEqual(imageFileName(`/x/${HEX.toUpperCase()}.webp`), undefined)
    assert.strictEqual(imageFileName(`/x/${HEX}.jpg`), undefined)
    assert.strictEqual(imageFileName(''), undefined)
  })
})

describe('photo props', () => {
  const images = [{ src: `/api/images/public/${HEX}.webp` }, { src: '/elsewhere/a.png' }]
  test('1-based index of the photos, with the file name when known', () => {
    assert.deepStrictEqual(photoProps(images, 0), { index: 1, of: 2, image: `${HEX}.webp` })
    assert.deepStrictEqual(photoProps(images, 1), { index: 2, of: 2 })
    assert.ok(!('image' in photoProps(images, 1)!))
  })
  test('valid photo_view / photo_dwell events', () => {
    assert.strictEqual(valid('photo_view', 'linen-dress', photoProps(images, 0)!), null)
    assert.strictEqual(valid('photo_dwell', 'linen-dress', { ...photoProps(images, 1), seconds: 1.25 }), null)
  })
  test('out of range: null (nothing to send)', () => {
    assert.strictEqual(photoProps(images, 2), null)
    assert.strictEqual(photoProps(images, -1), null)
    assert.strictEqual(photoProps([], 0), null)
  })
  test('capped at 50 photos (the allow-list range)', () => {
    const lots = Array.from({ length: 60 }, () => ({ src: `/api/images/public/${HEX}.webp` }))
    assert.deepStrictEqual(photoProps(lots, 3), { index: 4, of: 50, image: `${HEX}.webp` })
    assert.strictEqual(photoProps(lots, 55), null)
  })
})

const sec = (e: VideoWatchEvent | undefined) => (e?.props as { seconds?: number } | undefined)?.seconds

describe('video viewing', () => {
  function watch() {
    const events: VideoWatchEvent[] = []
    const w = createVideoWatch((e) => events.push(e))
    return { w, events, types: () => events.map((e) => (e.type === 'video_progress' ? `${e.type}:${e.props?.pct}` : e.type)) }
  }

  test('start once per viewing, then 25/50/75 as it plays', () => {
    const { w, types } = watch()
    w.playing()
    w.playing()
    for (let t = 0; t <= 8; t += 0.25) w.time(t, 10)
    assert.deepStrictEqual(types(), ['video_start', 'video_progress:25', 'video_progress:50', 'video_progress:75'])
  })

  test('a loop completes it (100) and is a replay; seconds watched at the end', () => {
    const { w, events, types } = watch()
    w.playing()
    for (let t = 0; t <= 9.75; t += 0.25) w.time(t, 10)
    w.time(0.25, 10) // looped
    for (let t = 0.5; t <= 9.75; t += 0.25) w.time(t, 10)
    w.time(0.1, 10) // looped again
    w.end()
    assert.deepStrictEqual(types(), [
      'video_start',
      'video_progress:25',
      'video_progress:50',
      'video_progress:75',
      'video_progress:100',
      'video_replay',
      'video_replay',
      'video_seconds',
    ])
    const seconds = sec(events[events.length - 1]) as number
    assert.ok(seconds > 19.5 && seconds < 20.5, String(seconds))
  })

  test('a jump (seek) adds no seconds; a pause stops counting', () => {
    const { w, events } = watch()
    w.playing()
    w.time(0, 30)
    w.time(1, 30)
    w.time(20, 30) // seek forward
    w.time(21, 30)
    w.end()
    assert.strictEqual(sec(events.at(-1)), 2)
  })

  test('ended (no loop) completes it', () => {
    const { w, types } = watch()
    w.playing()
    w.time(0, 4)
    w.time(1.5, 4)
    w.ended()
    assert.ok(types().includes('video_progress:100'))
  })

  test('flush (page hidden) sends the seconds so far and keeps the viewing', () => {
    const { w, events, types } = watch()
    w.playing()
    w.time(0, 30)
    w.time(2, 30)
    w.flush()
    w.time(3, 30)
    w.end()
    assert.deepStrictEqual(types(), ['video_start', 'video_seconds', 'video_seconds'])
    assert.deepStrictEqual(events.filter((e) => e.type === 'video_seconds').map(sec), [2, 1])
  })

  test('nothing watched: no seconds; a new viewing starts again', () => {
    const { w, types } = watch()
    w.end()
    w.playing()
    w.end()
    w.playing()
    assert.deepStrictEqual(types(), ['video_start', 'video_start'])
  })

  test('seconds capped at 600; bad durations ignored', () => {
    const { w, events } = watch()
    w.playing()
    w.time(0, Number.NaN)
    w.time(1, Number.POSITIVE_INFINITY)
    for (let i = 0; i < 1300; i += 1) w.time((i % 10) * 1, 10)
    w.end()
    const seconds = sec(events.filter((e) => e.type === 'video_seconds')[0]) as number
    assert.strictEqual(seconds, 600)
  })

  test('every event passes the allow-list', () => {
    const { w, events } = watch()
    w.playing()
    for (let t = 0; t <= 9.75; t += 0.25) w.time(t, 10)
    w.time(0.25, 10)
    w.end()
    for (const e of events) assert.strictEqual(valid(e.type, 'linen-dress', e.props ?? {}), null, e.type)
  })
})
