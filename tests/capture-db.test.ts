// ZP-1100: AI capture drafts against DATABASE_URL, with fake AI services.
// Only touches rows it creates (item numbers "ZP1100-*", "CAP-<its draft ids>", category slug "zp1100-*").
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-openai-key'
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-anthropic-key'

import sharp from 'sharp'
import prisma from '../src/lib/db'
import { LocalImageStorage } from '../src/lib/storage/local'
import { createDraft, updateDraft } from '../src/lib/capture/drafts'
import { regenerateSlot, runNextStep, type RunDeps } from '../src/lib/capture/run'
import { approveDraft } from '../src/lib/capture/approve'

let dir = ''
let storage: LocalImageStorage
let categoryId = 0
const draftIds: number[] = []

async function pic(r: number, g: number, b: number) {
  return new Uint8Array(await sharp({ create: { width: 64, height: 96, channels: 3, background: { r, g, b } } }).png().toBuffer())
}

let photoCalls = 0
let failNext = false
const listing = () => ({
  publicName: 'ZP1100 Pink Dress',
  description: 'A soft pink dress.',
  categoryId,
  colours: 'Pink',
  sizes: '4-8 years',
  fabric: null,
  care: null,
  altText: 'Pink dress',
  details: ['3 bows'],
})
function deps(): RunDeps {
  return {
    storage,
    writeListing: async () => {
      return { listing: listing(), costCents: 3 }
    },
    generateFashionPhoto: async () => {
      photoCalls++
      if (failNext) {
        failNext = false
        throw new Error('The image service is busy')
      }
      return { png: Buffer.from(await pic((photoCalls * 67) % 256, (photoCalls * 131) % 256, (photoCalls * 29) % 256)), costCents: 20 }
    },
  }
}

async function make(extra: Record<string, unknown> = {}, own = 0) {
  const d = await createDraft(
    prisma,
    { createdBy: 'zp1100-test', imageMode: own ? 'OWN' : 'AI', quantity: 5, unitCostRmb: 100, sellingPriceUsd: 30, ...extra },
    { reference: [await pic(200, 100, 100)], own: await Promise.all(Array.from({ length: own }, (_, i) => pic(10, 50 + i * 20, 200))) },
    storage,
  )
  draftIds.push(d.id)
  return d
}

async function runToEnd(id: number) {
  let d = await runNextStep(prisma, id, deps())
  for (let i = 0; i < 10 && d.status === 'GENERATING'; i++) d = await runNextStep(prisma, id, deps())
  return d
}

async function cleanup() {
  const products = await prisma.product.findMany({
    where: { OR: [{ itemNumber: { startsWith: 'ZP1100-' } }, { productName: { startsWith: 'ZP1100 ' } }, { captureDraft: { id: { in: draftIds } } }] },
    select: { id: true },
  })
  await prisma.captureDraft.deleteMany({ where: { OR: [{ id: { in: draftIds } }, { createdBy: 'zp1100-test' }, { productId: { in: products.map((p) => p.id) } }] } })
  const ids = products.map((p) => p.id)
  await prisma.stockMovement.deleteMany({ where: { productId: { in: ids } } })
  await prisma.product.deleteMany({ where: { id: { in: ids } } })
  await prisma.category.deleteMany({ where: { slug: { startsWith: 'zp1100-' } } })
}

before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'zp1100-'))
  storage = new LocalImageStorage(dir)
  await cleanup()
  categoryId = (await prisma.category.create({ data: { name: 'zp1100 dresses', slug: 'zp1100-dresses', published: true } })).id
})
after(async () => {
  await cleanup()
  await prisma.$disconnect()
  await rm(dir, { recursive: true, force: true })
})

describe('capture processing', () => {
  test('AI mode: listing, then one photo per call, then READY with 3 slots', async () => {
    const d = await make()
    assert.strictEqual(d.status, 'NEW')
    assert.deepStrictEqual(d.photos.generated, [null, null, null])

    let s = await runNextStep(prisma, d.id, deps())
    assert.strictEqual(s.status, 'GENERATING')
    assert.strictEqual(s.listing?.publicName, 'ZP1100 Pink Dress')
    for (let n = 1; n <= 3; n++) {
      s = await runNextStep(prisma, d.id, deps())
      assert.strictEqual(s.photos.generated.filter(Boolean).length, n)
      assert.strictEqual(s.status, n === 3 ? 'READY' : 'GENERATING')
    }
    assert.strictEqual(s.aiCostCents, 3 + 60)
    assert.ok(s.photos.generated.every((u) => u?.startsWith('/api/images/')))
    // READY: nothing more to do.
    const calls = photoCalls
    assert.strictEqual((await runNextStep(prisma, d.id, deps())).status, 'READY')
    assert.strictEqual(photoCalls, calls)
  })

  test('a failed step is FAILED with an error, and run retries it', async () => {
    const d = await make()
    await runNextStep(prisma, d.id, deps())
    failNext = true
    const failed = await runNextStep(prisma, d.id, deps())
    assert.strictEqual(failed.status, 'FAILED')
    assert.strictEqual(failed.error, 'The image service is busy')
    assert.strictEqual(failed.photos.generated.filter(Boolean).length, 0)
    const done = await runToEnd(d.id)
    assert.strictEqual(done.status, 'READY')
    assert.strictEqual(done.error, null)
    assert.strictEqual(done.photos.generated.filter(Boolean).length, 3)
  })

  test('a missing API key fails with a plain message', async () => {
    const d = await make()
    const saved = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    try {
      const s = await runNextStep(prisma, d.id, deps())
      assert.strictEqual(s.status, 'FAILED')
      assert.strictEqual(s.error, 'Anthropic key not set up')
    } finally {
      process.env.ANTHROPIC_API_KEY = saved
    }
  })

  test('two parallel calls never make the same photo', async () => {
    const d = await make()
    await runNextStep(prisma, d.id, deps())
    const before = photoCalls
    await Promise.all([runNextStep(prisma, d.id, deps()), runNextStep(prisma, d.id, deps()), runNextStep(prisma, d.id, deps())])
    assert.strictEqual(photoCalls - before, 1)
    const s = await runToEnd(d.id)
    assert.strictEqual(s.photos.generated.filter(Boolean).length, 3)
  })

  test('OWN mode runs the listing only; regenerate clears one slot', async () => {
    const d = await make({}, 2)
    const calls = photoCalls
    const s = await runNextStep(prisma, d.id, deps())
    assert.strictEqual(s.status, 'READY')
    assert.strictEqual(photoCalls, calls)
    assert.strictEqual(s.photos.own.length, 2)
    await assert.rejects(() => regenerateSlot(prisma, d.id, 0), /own photos/)

    const ai = await make()
    await runToEnd(ai.id)
    const r = await regenerateSlot(prisma, ai.id, 1)
    assert.strictEqual(r.status, 'GENERATING')
    assert.strictEqual(r.photos.generated[1], null)
    assert.ok(r.photos.generated[0])
    assert.strictEqual((await runToEnd(ai.id)).status, 'READY')
  })

  test('edits are validated and refused after approval', async () => {
    const d = await make()
    await assert.rejects(() => updateDraft(prisma, d.id, { quantity: 0 }), /whole number/)
    const u = await updateDraft(prisma, d.id, { quantity: 7, listingType: 'PRE_ORDER', shipFrom: '2027-02-01', id: 99999 })
    assert.strictEqual(u.id, d.id)
    assert.strictEqual(u.quantity, 7)
    assert.strictEqual(u.shipFrom, '2027-02-01')
  })
})

describe('approve', () => {
  test('IN_STOCK: product, opening stock movement and gallery order', async () => {
    await prisma.exchangeRate.create({ data: { rmbToUsd: 0.14, effectiveDate: new Date('2999-01-01'), notes: 'ZP1100 test' } })
    try {
      const d = await make()
      await runToEnd(d.id)
      const r = await approveDraft(prisma, d.id, { publish: true, username: 'owner' })
      assert.strictEqual(r.published, true)
      const p = await prisma.product.findUniqueOrThrow({
        where: { id: r.productId },
        include: { images: { orderBy: { sortOrder: 'asc' } }, stockMovements: true },
      })
      assert.strictEqual(p.itemNumber, `CAP-${d.id}`)
      assert.strictEqual(p.productName, 'ZP1100 Pink Dress')
      assert.strictEqual(p.currentQuantity, 5)
      assert.strictEqual(p.openingQuantity, 5)
      assert.strictEqual(p.unitCostRmb, 100)
      assert.strictEqual(p.unitCostUsd, 14)
      assert.strictEqual(p.priceDisplay, 'SHOW_PRICE')
      assert.strictEqual(p.categoryId, categoryId)
      assert.strictEqual(p.published, true)
      assert.strictEqual(p.stockMovements.length, 1)
      assert.strictEqual(p.stockMovements[0].movementType, 'OPENING_BALANCE')
      assert.strictEqual(p.stockMovements[0].closingBalance, 5)
      assert.strictEqual(p.images.length, 4)
      assert.deepStrictEqual(p.images.map((i) => i.aiGenerated), [true, true, true, false])
      assert.deepStrictEqual(p.images.map((i) => i.isPrimary), [true, false, false, false])
      assert.ok(p.images.every((i) => i.alt === 'Pink dress'))
      assert.strictEqual(p.imageUrl, `/api/images/${p.images[0].imageKey.slice('products/'.length)}`)
      const after = await prisma.captureDraft.findUniqueOrThrow({ where: { id: d.id } })
      assert.strictEqual(after.status, 'APPROVED')
      assert.strictEqual(after.productId, p.id)
      await assert.rejects(() => updateDraft(prisma, d.id, { quantity: 2 }), /already approved/)
    } finally {
      await prisma.exchangeRate.deleteMany({ where: { notes: 'ZP1100 test' } })
    }
  })

  test('PRE_ORDER keeps stock at 0 with the ship window; OWN photos come first', async () => {
    const d = await make({ listingType: 'PRE_ORDER', shipFrom: '2027-02-01', shipTo: '2027-03-31', quantity: 12 }, 2)
    await runToEnd(d.id)
    const r = await approveDraft(prisma, d.id, { publish: false, itemNumber: 'ZP1100-PRE', username: 'owner' })
    assert.strictEqual(r.published, false)
    const p = await prisma.product.findUniqueOrThrow({
      where: { id: r.productId },
      include: { images: { orderBy: { sortOrder: 'asc' } }, stockMovements: true },
    })
    assert.strictEqual(p.listingType, 'PRE_ORDER')
    assert.strictEqual(p.currentQuantity, 0)
    assert.strictEqual(p.openingQuantity, 0)
    assert.strictEqual(p.preorderExpectedQty, 12)
    assert.strictEqual(p.preorderShipFrom?.toISOString().slice(0, 10), '2027-02-01')
    assert.strictEqual(p.preorderShipTo?.toISOString().slice(0, 10), '2027-03-31')
    assert.strictEqual(p.stockMovements.length, 0)
    assert.deepStrictEqual(p.images.map((i) => i.aiGenerated), [false, false, false])
    assert.strictEqual(p.images.length, 3)
    assert.strictEqual(p.published, false)
  })

  test('duplicate item number is refused; unfinished drafts cannot be approved', async () => {
    const a = await make({}, 1)
    await runToEnd(a.id)
    await approveDraft(prisma, a.id, { publish: false, itemNumber: 'ZP1100-DUP', username: 'owner' })
    const b = await make({}, 1)
    await runToEnd(b.id)
    await assert.rejects(
      () => approveDraft(prisma, b.id, { publish: false, itemNumber: 'ZP1100-DUP', username: 'owner' }),
      (e: { status?: number }) => e.status === 400,
    )
    assert.strictEqual((await prisma.captureDraft.findUniqueOrThrow({ where: { id: b.id } })).status, 'READY')

    const c = await make()
    await runNextStep(prisma, c.id, deps())
    await assert.rejects(() => approveDraft(prisma, c.id, { publish: false, username: 'owner' }), /not all ready/)
  })

  test('publish without a category creates the product and reports what is missing', async () => {
    const d = await make({}, 1)
    await runToEnd(d.id)
    await prisma.captureDraft.update({ where: { id: d.id }, data: { listing: { ...listing(), categoryId: null } } })
    const r = await approveDraft(prisma, d.id, { publish: true, itemNumber: 'ZP1100-NOCAT', username: 'owner' })
    assert.strictEqual(r.published, false)
    assert.ok(r.missing?.includes('category'))
  })
})
