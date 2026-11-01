/**
 * ZP-507: "Love it" hearts, pure parts.
 * - The dedupe hash: salted (keyed) HMAC of device id + product, never the
 *   device id itself; the key from LOVES_HASH_SECRET or derived from JWT_SECRET.
 * - The request body allow-list ({ slug, on, device }).
 * - Count display: never below 0, hidden under 3 ("Love" / "Love it").
 * - The loved-on-this-phone list in localStorage (bounded, valid slugs only).
 * - One request in flight per piece; the last tap wins.
 */
import { describe, test } from 'node:test'
import assert from 'node:assert'
import { loveHash, loveHashKey } from '../src/lib/loves/hash'
import {
  displayLoves,
  feedLoveText,
  LOVE_COUNT_MIN_SHOWN,
  LOVED_MAX_STORED,
  loveButtonLabel,
  parseLovedSlugs,
  parseLoveRequest,
  productLoveText,
  serializeLovedSlugs,
  withLoved,
} from '../src/lib/loves/model'
import { createLoveSync } from '../src/lib/loves/sync'

const DEVICE = '7d7d7d7d-0000-4000-8000-000000000001'
const OTHER_DEVICE = '7d7d7d7d-0000-4000-8000-000000000002'
const SECRET_A = 'a'.repeat(40)
const SECRET_B = 'b'.repeat(40)

describe('love hash', () => {
  const key = loveHashKey({ LOVES_HASH_SECRET: SECRET_A, NODE_ENV: 'production' })

  test('64 hex characters, stable for the same device and piece', () => {
    const h = loveHash(key, DEVICE, 12)
    assert.match(h, /^[0-9a-f]{64}$/)
    assert.strictEqual(loveHash(key, DEVICE, 12), h)
  })

  test('differs per piece and per device, and never contains the device id', () => {
    const h = loveHash(key, DEVICE, 12)
    assert.notStrictEqual(loveHash(key, DEVICE, 13), h)
    assert.notStrictEqual(loveHash(key, OTHER_DEVICE, 12), h)
    assert.ok(!h.includes(DEVICE.replace(/-/g, '')))
  })

  test('device ids are compared case-insensitively', () => {
    assert.strictEqual(loveHash(key, DEVICE.toUpperCase(), 12), loveHash(key, DEVICE, 12))
  })

  test('salted: another secret gives another hash', () => {
    const other = loveHashKey({ LOVES_HASH_SECRET: SECRET_B, NODE_ENV: 'production' })
    assert.notStrictEqual(loveHash(other, DEVICE, 12), loveHash(key, DEVICE, 12))
  })

  test('development / test without LOVES_HASH_SECRET: a key derived from JWT_SECRET (not equal to it)', () => {
    for (const NODE_ENV of ['development', 'test']) {
      const derived = loveHashKey({ JWT_SECRET: SECRET_A, NODE_ENV })
      assert.notDeepStrictEqual(derived, Buffer.from(SECRET_A))
      assert.notStrictEqual(loveHash(derived, DEVICE, 12), loveHash(key, DEVICE, 12))
      assert.deepStrictEqual(loveHashKey({ JWT_SECRET: SECRET_A, NODE_ENV }), derived)
    }
  })

  test('production REQUIRES LOVES_HASH_SECRET: no fallback to the JWT secret (fails closed)', () => {
    assert.throws(() => loveHashKey({ JWT_SECRET: SECRET_A, NODE_ENV: 'production' }), /LOVES_HASH_SECRET/)
    assert.throws(() => loveHashKey({ LOVES_HASH_SECRET: '', JWT_SECRET: SECRET_A, NODE_ENV: 'production' }), /LOVES_HASH_SECRET/)
    assert.throws(() => loveHashKey({ NODE_ENV: 'production' }), /LOVES_HASH_SECRET/)
    assert.throws(() => loveHashKey({}), /LOVES_HASH_SECRET/)
  })

  test('a set but short LOVES_HASH_SECRET throws everywhere (never a silent fallback)', () => {
    for (const NODE_ENV of ['production', 'development', 'test']) {
      assert.throws(() => loveHashKey({ LOVES_HASH_SECRET: 'x'.repeat(31), JWT_SECRET: SECRET_A, NODE_ENV }), /at least 32/)
    }
    assert.doesNotThrow(() => loveHashKey({ LOVES_HASH_SECRET: 'x'.repeat(32), NODE_ENV: 'production' }))
  })
})

describe('love request body', () => {
  test('accepts exactly { slug, on, device }', () => {
    assert.deepStrictEqual(parseLoveRequest({ slug: 'linen-dress', on: true, device: DEVICE }), {
      ok: true,
      value: { slug: 'linen-dress', on: true, device: DEVICE.toLowerCase() },
    })
    assert.strictEqual(parseLoveRequest({ slug: 'linen-dress', on: false, device: DEVICE }).ok, true)
  })

  test('refuses anything else', () => {
    const bad: unknown[] = [
      null,
      'x',
      [],
      {},
      { slug: 'linen-dress', on: true },
      { slug: 'linen-dress', device: DEVICE },
      { on: true, device: DEVICE },
      { slug: 'Linen Dress', on: true, device: DEVICE },
      { slug: 'linen-dress', on: 'yes', device: DEVICE },
      { slug: 'linen-dress', on: 1, device: DEVICE },
      { slug: 'linen-dress', on: true, device: 'not-a-uuid' },
      { slug: 'linen-dress', on: true, device: '7d7d7d7d-0000-1000-8000-000000000001' }, // not v4
      { slug: 'linen-dress', on: true, device: DEVICE, name: 'Grace' },
      { slug: 'x'.repeat(200), on: true, device: DEVICE },
    ]
    for (const body of bad) assert.strictEqual(parseLoveRequest(body).ok, false, JSON.stringify(body))
  })
})

describe('count display', () => {
  test('server count plus what this phone changed since the page loaded, never below 0', () => {
    assert.strictEqual(displayLoves(10, false, false), 10)
    assert.strictEqual(displayLoves(10, true, false), 11)
    assert.strictEqual(displayLoves(10, false, true), 9)
    assert.strictEqual(displayLoves(10, true, true), 10)
    assert.strictEqual(displayLoves(0, false, true), 0)
    assert.strictEqual(displayLoves(undefined, true, false), 1)
    assert.strictEqual(displayLoves(-4, false, false), 0)
    assert.strictEqual(displayLoves(Number.NaN, false, false), 0)
  })

  test(`numbers only from ${LOVE_COUNT_MIN_SHOWN} loves`, () => {
    assert.strictEqual(LOVE_COUNT_MIN_SHOWN, 3)
    assert.strictEqual(feedLoveText(0), 'Love')
    assert.strictEqual(feedLoveText(2), 'Love')
    assert.strictEqual(feedLoveText(3), '3')
    assert.strictEqual(feedLoveText(24), '24')
    assert.strictEqual(productLoveText(1), 'Love it')
    assert.strictEqual(productLoveText(2), 'Love it')
    assert.strictEqual(productLoveText(3), 'Loved by 3')
    assert.strictEqual(productLoveText(24), 'Loved by 24')
    assert.strictEqual(productLoveText(1234), 'Loved by 1,234')
  })
})

describe('accessible name contains the visible text', () => {
  test('rail and pill, under and from 3 loves', () => {
    const cases: [Parameters<typeof loveButtonLabel>, string, string][] = [
      [['rail', 'Lime dress', 2], 'Love Lime dress', feedLoveText(2)],
      [['rail', 'Lime dress', 24], 'Love Lime dress, loved by 24', feedLoveText(24)],
      [['pill', 'Lime dress', 0], 'Love it, Lime dress', productLoveText(0)],
      [['pill', 'Lime dress', 24], 'Love Lime dress, loved by 24', productLoveText(24)],
      [['pill', 'Lime dress', 1234], 'Love Lime dress, loved by 1,234', productLoveText(1234)],
    ]
    for (const [args, label, visible] of cases) {
      assert.strictEqual(loveButtonLabel(...args), label)
      assert.ok(label.toLowerCase().includes(visible.toLowerCase()), `${label} / ${visible}`)
    }
  })
})

describe('loved pieces on this phone', () => {
  test('parse: valid slugs only, unique; junk is an empty list', () => {
    assert.deepStrictEqual(parseLovedSlugs(null), [])
    assert.deepStrictEqual(parseLovedSlugs('not json'), [])
    assert.deepStrictEqual(parseLovedSlugs('{"a":1}'), [])
    assert.deepStrictEqual(parseLovedSlugs('["a-1","Bad Slug",3,"a-1","b"]'), ['a-1', 'b'])
  })

  test('add / remove, bounded to the most recent ones', () => {
    assert.deepStrictEqual(withLoved(['a'], 'b', true), ['a', 'b'])
    assert.deepStrictEqual(withLoved(['a', 'b'], 'a', true), ['b', 'a'])
    assert.deepStrictEqual(withLoved(['a', 'b'], 'a', false), ['b'])
    assert.deepStrictEqual(withLoved([], 'a', false), [])
    const many = Array.from({ length: LOVED_MAX_STORED + 5 }, (_, i) => `p-${i}`)
    const kept = parseLovedSlugs(serializeLovedSlugs(many))
    assert.strictEqual(kept.length, LOVED_MAX_STORED)
    assert.strictEqual(kept[kept.length - 1], `p-${LOVED_MAX_STORED + 4}`)
  })
})

describe('love sync (one request per piece in flight, last tap wins)', () => {
  function harness() {
    const sent: { slug: string; on: boolean; resolve: (ok: boolean) => void }[] = []
    const sync = createLoveSync({
      send: (slug, on) =>
        new Promise<boolean>((resolve) => {
          sent.push({ slug, on, resolve })
        }),
    })
    return { sent, sync }
  }
  const tick = () => new Promise((r) => setTimeout(r, 0))

  test('sends once per change', async () => {
    const { sent, sync } = harness()
    sync.set('a', true)
    assert.deepStrictEqual(sent.map((s) => [s.slug, s.on]), [['a', true]])
    sent[0].resolve(true)
    await tick()
    assert.strictEqual(sent.length, 1)
  })

  test('taps while a request is in flight: only the final state is sent next', async () => {
    const { sent, sync } = harness()
    sync.set('a', true)
    sync.set('a', false)
    sync.set('a', true)
    sync.set('a', false)
    assert.strictEqual(sent.length, 1)
    sent[0].resolve(true)
    await tick()
    assert.deepStrictEqual(sent.map((s) => s.on), [true, false])
    sent[1].resolve(true)
    await tick()
    assert.strictEqual(sent.length, 2)
  })

  test('back to the state the server has: nothing more is sent', async () => {
    const { sent, sync } = harness()
    sync.set('a', true)
    sync.set('a', false)
    sync.set('a', true)
    sent[0].resolve(true)
    await tick()
    assert.strictEqual(sent.length, 1)
  })

  test('pieces are independent', () => {
    const { sent, sync } = harness()
    sync.set('a', true)
    sync.set('b', true)
    assert.deepStrictEqual(sent.map((s) => s.slug), ['a', 'b'])
  })

  test('a failed request is not retried in a loop', async () => {
    const { sent, sync } = harness()
    sync.set('a', true)
    sent[0].resolve(false)
    await tick()
    assert.strictEqual(sent.length, 1)
    sync.set('a', false)
    sync.set('a', true)
    // The server state is unknown after a failure: the latest tap is sent again.
    assert.strictEqual(sent.length, 2)
  })
})
