// ZP-508 security review fixes, no database:
// - a live review token never reaches analytics (client normalizePage and
//   server validateEvent both store "/review"),
// - the review page response headers (no Referer, no caching),
// - the public photo endpoint refuses before reading the body (same-origin,
//   Content-Length required and capped), and only JPEG/PNG/WebP is accepted
//   by the type check it uses,
// - deleting a stored picture through the local driver.
import { describe, test } from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { normalizePage } from '../src/lib/analytics/context'
import { isPrivatePagePath, redactPrivatePath, validateBatch, validateEvent } from '../src/lib/analytics/events'
import { REVIEW_RESPONSE_HEADERS, isReviewPagePath } from '../src/lib/reviews/route-headers'
import { REVIEW_PHOTO_MAX_BYTES, REVIEW_TOKEN_HEADER } from '../src/lib/reviews/rules'
import { generateReviewToken } from '../src/lib/reviews/token'
import { LocalImageStorage } from '../src/lib/storage/local'
import { proxy } from '../src/proxy'
import { NextRequest } from 'next/server'
import * as photoRoute from '../src/app/api/public/reviews/photo/route'

const TOKEN = generateReviewToken().token
const NOW = new Date('2026-11-01T10:00:00Z')
let n = 0
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`

describe('analytics never stores a review token', () => {
  test('normalizePage maps /review/<anything> to /review on both front doors', () => {
    assert.strictEqual(normalizePage(`/site/review/${TOKEN}`), '/review')
    assert.strictEqual(normalizePage(`/review/${TOKEN}`), '/review')
    assert.strictEqual(normalizePage('/review'), '/review')
    assert.strictEqual(normalizePage('/review/'), '/review')
    assert.strictEqual(normalizePage('/reviews-guide'), '/reviews-guide')
    assert.strictEqual(normalizePage('/p/review-dress'), '/p/review-dress')
  })

  test('the server redacts page and the landing prop, whatever the client sends', () => {
    assert.ok(isPrivatePagePath(`/site/review/${TOKEN}`))
    assert.strictEqual(redactPrivatePath(`/review/${TOKEN}`), '/review')
    const start = validateEvent(
      {
        id: id(),
        type: 'visit_start',
        at: NOW.getTime(),
        page: `/site/review/${TOKEN}`,
        props: { ref: 'direct', device: 'phone', vw: 390, vh: 844, landing: `/review/${TOKEN}`, returning: false },
      },
      NOW,
    )
    assert.ok(typeof start !== 'string', String(start))
    assert.strictEqual(start.page, '/review')
    assert.strictEqual(start.props.landing, '/review')
    assert.ok(!JSON.stringify(start).includes(TOKEN))
  })

  test('a whole batch keeps no token anywhere', () => {
    const r = validateBatch(
      {
        v: 1,
        visit: '00000000-0000-4000-8000-00000000abcd',
        events: [{ id: id(), type: 'visit_end', at: NOW.getTime(), page: `/review/${TOKEN}`, props: { duration: 3, looks: 0 } }],
      },
      NOW,
    )
    assert.ok(r.ok, r.ok ? '' : r.error)
    assert.ok(!JSON.stringify(r.events).includes(TOKEN))
  })
})

describe('review page response headers', () => {
  test('no-referrer, private no-store, noindex on /review and /site/review', () => {
    assert.ok(isReviewPagePath(`/site/review/${TOKEN}`))
    assert.ok(isReviewPagePath(`/review/${TOKEN}`))
    assert.ok(!isReviewPagePath('/api/public/reviews'))
    assert.ok(!isReviewPagePath('/p/review-dress'))
    assert.strictEqual(REVIEW_RESPONSE_HEADERS['Referrer-Policy'], 'no-referrer')
    assert.match(REVIEW_RESPONSE_HEADERS['Cache-Control'], /no-store/)
  })

  test('the proxy adds them (admin host /site/review and storefront host /review)', () => {
    const before = { s: process.env.GRACE_STOREFRONT_HOSTS, a: process.env.GRACE_ADMIN_HOSTS }
    process.env.GRACE_STOREFRONT_HOSTS = 'vyra.example'
    process.env.GRACE_ADMIN_HOSTS = 'admin.example'
    try {
      for (const [host, p] of [
        ['admin.example', `/site/review/${TOKEN}`],
        ['vyra.example', `/review/${TOKEN}`],
      ]) {
        const res = proxy(new NextRequest(`https://${host}${p}`, { headers: { host } }))
        assert.strictEqual(res.headers.get('referrer-policy'), 'no-referrer', `${host}${p}`)
        assert.match(res.headers.get('cache-control') ?? '', /no-store/)
      }
      const other = proxy(new NextRequest('https://vyra.example/shop', { headers: { host: 'vyra.example' } }))
      assert.strictEqual(other.headers.get('referrer-policy'), null)
    } finally {
      if (before.s === undefined) delete process.env.GRACE_STOREFRONT_HOSTS
      else process.env.GRACE_STOREFRONT_HOSTS = before.s
      if (before.a === undefined) delete process.env.GRACE_ADMIN_HOSTS
      else process.env.GRACE_ADMIN_HOSTS = before.a
    }
  })
})

describe('photo endpoint refuses before reading the body (no database needed)', () => {
  type Handler = (req: Request) => Promise<Response>
  const post = photoRoute.POST as Handler
  const same = { origin: 'http://localhost:3455', host: 'localhost:3455' }
  // Each case uses its own client address so the per-IP limiter never interferes.
  let ip = 0
  const headers = (extra: Record<string, string>) => ({ ...same, 'x-forwarded-for': `10.9.0.${++ip}`, [REVIEW_TOKEN_HEADER]: TOKEN, ...extra })

  test('cross-site: 403', async () => {
    const res = await post(
      new Request('http://localhost:3455/api/public/reviews/photo', {
        method: 'POST',
        headers: { ...headers({ 'content-length': '10' }), origin: 'https://evil.example' },
      }),
    )
    assert.strictEqual(res.status, 403)
  })

  test('no Content-Length: 411; too large declared: 413 (body never read)', async () => {
    let read = false
    // highWaterMark 0: pull() runs only when someone actually reads.
    const body = new ReadableStream(
      {
        pull() {
          read = true
          throw new Error('the body must not be read')
        },
      },
      { highWaterMark: 0 },
    )
    const noLength = await post(
      new Request('http://localhost:3455/api/public/reviews/photo', { method: 'POST', headers: headers({}), body, duplex: 'half' } as RequestInit),
    )
    assert.strictEqual(noLength.status, 411)
    const big = await post(
      new Request('http://localhost:3455/api/public/reviews/photo', {
        method: 'POST',
        headers: headers({ 'content-length': String(REVIEW_PHOTO_MAX_BYTES * 2) }),
      }),
    )
    assert.strictEqual(big.status, 413)
    assert.strictEqual(read, false)
  })
})

describe('local storage delete', () => {
  test('removes the file; a missing key is not an error; invalid keys refused', async () => {
    const dir = fs.mkdtempSync(path.join(process.env.TEMP || os.tmpdir(), 'zp508-del-'))
    try {
      const storage = new LocalImageStorage(dir)
      const key = `products/${'b'.repeat(32)}.webp`
      await storage.put(key, Buffer.from('x'))
      assert.ok(await storage.exists(key))
      await storage.delete(key)
      assert.ok(!(await storage.exists(key)))
      await storage.delete(key)
      await assert.rejects(storage.delete('../etc/passwd'))
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
