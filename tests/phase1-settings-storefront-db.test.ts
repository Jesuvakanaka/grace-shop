// Phase 1 consolidation (database): site settings pictures are public
// through /api/images/public, and the cached catalogue takes its "few left"
// threshold from site settings. Only touches rows it creates ("P1C-*",
// "p1c-*") and the SiteSettings row, which it saves and restores.
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import prisma from '../src/lib/db'
import { LocalImageStorage } from '../src/lib/storage/local'
import { servePublicImage } from '../src/lib/storefront/public-image'
import { isPublicImageKey } from '../src/lib/storefront/queries'
import { ByteLruCache } from '../src/lib/storefront/resize-cache'
import { createStorefront, type CacheFn } from '../src/lib/storefront/cached'
import { updateSiteSettings } from '../src/lib/site-settings/db'

const HEX = (c: string) => c.repeat(32)
const KEY = (c: string) => `products/${HEX(c)}.webp`
const FILE = (c: string) => `${HEX(c)}.webp`

type Row = Awaited<ReturnType<typeof prisma.siteSettings.findUnique>>
let saved: Row = null
let tmp: string
let storage: LocalImageStorage

async function cleanup() {
  await prisma.product.deleteMany({ where: { itemNumber: { startsWith: 'P1C-' } } })
  await prisma.category.deleteMany({ where: { slug: { startsWith: 'p1c-' } } })
}

// A stand-in for unstable_cache that never caches (every call loads).
const noCache: CacheFn = ((fn: () => Promise<unknown>) => fn) as unknown as CacheFn

describe('phase 1: settings pictures and threshold', () => {
  before(async () => {
    await cleanup()
    saved = await prisma.siteSettings.findUnique({ where: { id: 1 } })
    tmp = await mkdtemp(path.join(tmpdir(), 'p1c-'))
    storage = new LocalImageStorage(tmp)
    for (const c of ['a', 'b', 'c', 'd', 'e', 'f']) await storage.put(KEY(c), Buffer.from(`webp-${c}`))

    const cat = await prisma.category.create({ data: { slug: 'p1c-cat', name: 'P1C', published: true } })
    const p = await prisma.product.create({
      data: { itemNumber: 'P1C-1', productName: 'P1C one', slug: 'p1c-one', published: true, publishedAt: new Date(), categoryId: cat.id, currentQuantity: 2 },
    })
    // Key "e" belongs to a published product too.
    await prisma.productImage.create({ data: { productId: p.id, imageKey: KEY('e'), isPrimary: true } })

    await updateSiteSettings(
      prisma,
      { heroImageKeyDesktop: KEY('a'), heroImageKeyMobile: KEY('b'), aboutImageKey: KEY('c'), seoShareImageKey: KEY('d'), fewLeftThreshold: 1 },
      'p1c-test',
    )
  })

  after(async () => {
    await cleanup()
    await prisma.siteSettings.deleteMany({})
    if (saved) await prisma.siteSettings.create({ data: { ...saved, openingHours: saved.openingHours ?? undefined } })
    await rm(tmp, { recursive: true, force: true })
    await prisma.$disconnect()
  })

  const get = (file: string, query = '') =>
    servePublicImage(file, new URLSearchParams(query), { db: prisma, storage, cache: new ByteLruCache(1024 * 1024) })

  test('every settings picture is public', async () => {
    for (const c of ['a', 'b', 'c', 'd']) assert.strictEqual(await isPublicImageKey(prisma, KEY(c)), true, c)
  })

  test('a settings hero key returns 200 with the public headers', async () => {
    const res = await get(FILE('a'))
    assert.strictEqual(res.status, 200)
    assert.strictEqual(await res.text(), 'webp-a')
    assert.match(res.headers.get('cache-control') ?? '', /^public, max-age=300/)
    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff')
  })

  test('after the hero is replaced, the old key is 404 (no-store) unless a published product uses it', async () => {
    await updateSiteSettings(prisma, { heroImageKeyDesktop: KEY('e') }, 'p1c-test')
    const old = await get(FILE('a'))
    assert.strictEqual(old.status, 404)
    assert.strictEqual(old.headers.get('cache-control'), 'no-store')
    assert.strictEqual((await get(FILE('e'))).status, 200)

    // "e" leaves settings but a published product still uses it.
    await updateSiteSettings(prisma, { heroImageKeyDesktop: KEY('a') }, 'p1c-test')
    assert.strictEqual((await get(FILE('e'))).status, 200)
    assert.strictEqual((await get(FILE('a'))).status, 200)
  })

  test('a random stored key is 404', async () => {
    const res = await get(FILE('f'))
    assert.strictEqual(res.status, 404)
    assert.strictEqual(res.headers.get('cache-control'), 'no-store')
    assert.strictEqual(await isPublicImageKey(prisma, KEY('f')), false)
  })

  test('the width allow-list still applies to settings pictures', async () => {
    assert.strictEqual((await get(FILE('a'), 'w=333')).status, 400)
  })

  test('the cached catalogue uses the few-left threshold from site settings', async () => {
    const availability = async () => {
      const r = (await createStorefront({ db: prisma, cache: noCache }).getPublishedProductBySlug('p1c-one')) as {
        product: { availability: string }
      }
      return r.product.availability
    }
    await updateSiteSettings(prisma, { fewLeftThreshold: 1 }, 'p1c-test')
    assert.strictEqual(await availability(), 'IN_STOCK', 'quantity 2 > threshold 1')
    await updateSiteSettings(prisma, { fewLeftThreshold: 5 }, 'p1c-test')
    assert.strictEqual(await availability(), 'FEW_LEFT', 'quantity 2 <= threshold 5')
  })

  test('no settings row: the default threshold (3)', async () => {
    const row = await prisma.siteSettings.findUniqueOrThrow({ where: { id: 1 } })
    await prisma.siteSettings.deleteMany({})
    try {
      const r = (await createStorefront({ db: prisma, cache: noCache }).getPublishedProductBySlug('p1c-one')) as {
        product: { availability: string }
      }
      assert.strictEqual(r.product.availability, 'FEW_LEFT')
    } finally {
      await prisma.siteSettings.create({ data: { ...row, openingHours: row.openingHours ?? undefined } })
    }
  })
})
