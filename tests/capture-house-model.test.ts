// AI capture house model: set / get / clear against DATABASE_URL with local fake storage.
// Restores the SiteSettings column it touched.
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import sharp from 'sharp'
import prisma from '../src/lib/db'
import { LocalImageStorage } from '../src/lib/storage/local'
import { clearHouseModel, getHouseModel, getHouseModelKey, setHouseModel } from '../src/lib/capture/house-model'

let dir = ''
let storage: LocalImageStorage
let original: string | null = null
let hadRow = false

before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'house-model-'))
  storage = new LocalImageStorage(dir)
  const row = await prisma.siteSettings.findUnique({ where: { id: 1 }, select: { captureHouseModelKey: true } })
  hadRow = !!row
  original = row?.captureHouseModelKey ?? null
})

after(async () => {
  if (hadRow) await prisma.siteSettings.update({ where: { id: 1 }, data: { captureHouseModelKey: original } })
  else await prisma.siteSettings.deleteMany({ where: { id: 1 } })
  await rm(dir, { recursive: true, force: true })
  await prisma.$disconnect()
})

describe('house model', () => {
  test('set, get and clear', async () => {
    const png = new Uint8Array(await sharp({ create: { width: 64, height: 96, channels: 3, background: { r: 200, g: 120, b: 90 } } }).png().toBuffer())
    const { url } = await setHouseModel(prisma, png, storage)
    assert.ok(url.length > 0)
    const key = await getHouseModelKey(prisma)
    assert.ok(key)
    assert.deepStrictEqual(await getHouseModel(prisma), { url })

    await clearHouseModel(prisma)
    assert.strictEqual(await getHouseModelKey(prisma), null)
    assert.deepStrictEqual(await getHouseModel(prisma), { url: null })
  })

  test('rejects a file that is not a picture', async () => {
    await assert.rejects(setHouseModel(prisma, new Uint8Array([1, 2, 3]), storage), (e: { status?: number }) => e.status === 400)
  })
})
