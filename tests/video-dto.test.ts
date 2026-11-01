// ZP-501: the optional public `video` on the product DTO. Pure (no database).
// Allow-list: exactly { src, poster, width, height } of a READY video, public
// URLs only; no keys, status, duration, size, error or createdBy.
import { describe, test } from 'node:test'
import assert from 'node:assert'
import { toPublicProduct, type PublicProductRow } from '../src/lib/storefront/dto'
import { withPreviewImages } from '../src/lib/storefront/preview'

const NOW = new Date('2026-11-01T12:00:00Z')
const V = (c: string) => `videos/${c.repeat(32)}.mp4`
const P = (c: string) => `videos/${c.repeat(32)}.webp`

type VideoRow = NonNullable<PublicProductRow['video']>

function row(video: PublicProductRow['video']): PublicProductRow {
  return {
    id: 1,
    itemNumber: 'ITEM-1',
    productName: 'Gold dress',
    publicName: null,
    slug: 'gold-dress',
    publicDescription: null,
    colours: null,
    sizes: null,
    featured: false,
    sortOrder: 0,
    published: true,
    publishedAt: new Date('2026-09-01T00:00:00Z'),
    priceDisplay: 'ASK_FOR_PRICE',
    sellingPriceUsd: 0,
    currentQuantity: 3,
    category: { slug: 'dresses', name: 'Dresses', published: true },
    images: [{ id: 1, imageKey: `products/${'a'.repeat(32)}.webp`, alt: null, sortOrder: 0, isPrimary: true }],
    video,
  }
}

const READY: VideoRow = {
  status: 'READY',
  videoKey: V('b'),
  posterKey: P('c'),
  width: 720,
  height: 1280,
  // Present on the row (a raw select could carry them) but never copied:
  durationMs: 5000,
  sizeBytes: 123456,
  error: null,
  createdBy: 'owner',
} as VideoRow

describe('public product DTO: video', () => {
  test('a READY video is exactly { src, poster, width, height } with public URLs', () => {
    const dto = toPublicProduct(row(READY), { now: NOW })
    assert.deepStrictEqual(dto.video, {
      src: `/api/videos/public/${'b'.repeat(32)}.mp4`,
      poster: `/api/videos/public/${'c'.repeat(32)}.webp`,
      width: 720,
      height: 1280,
    })
    assert.deepStrictEqual(Object.keys(dto.video!).sort(), ['height', 'poster', 'src', 'width'])
    const json = JSON.stringify(dto)
    for (const leak of ['READY', 'videoKey', 'posterKey', 'durationMs', 'sizeBytes', 'createdBy', '"videos/']) {
      assert.ok(!json.includes(leak), `DTO leaks ${leak}`)
    }
  })

  test('no video, or one that is PROCESSING, FAILED, has a bad key or no size, is null', () => {
    assert.strictEqual(toPublicProduct(row(null), { now: NOW }).video, null)
    assert.strictEqual(toPublicProduct(row(undefined), { now: NOW }).video, null)
    for (const bad of [
      { ...READY, status: 'PROCESSING' },
      { ...READY, status: 'FAILED' },
      { ...READY, videoKey: `videos/../${'b'.repeat(32)}.mp4` },
      { ...READY, videoKey: `products/${'b'.repeat(32)}.webp` },
      { ...READY, posterKey: null },
      { ...READY, width: null },
      { ...READY, height: 0 },
    ] as VideoRow[]) {
      assert.strictEqual(toPublicProduct(row(bad), { now: NOW }).video, null, JSON.stringify(bad))
    }
  })

  test('owner preview points the video at the signed-in route', () => {
    const preview = withPreviewImages(toPublicProduct(row(READY), { now: NOW }))
    assert.deepStrictEqual(preview.video, {
      src: `/api/videos/${'b'.repeat(32)}.mp4`,
      poster: `/api/videos/${'c'.repeat(32)}.webp`,
      width: 720,
      height: 1280,
    })
    assert.strictEqual(withPreviewImages(toPublicProduct(row(null), { now: NOW })).video, null)
  })
})
