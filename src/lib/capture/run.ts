// One processing step per call (ZP-1100). Server only. See "Processing" in
// docs/storefront/ai-capture.md. Cloud Run gives CPU only during a request, so the
// browser calls this again and again until the draft is READY.
import type { CaptureDraft, Prisma, PrismaClient } from '@prisma/client'
import { aiStatus } from '@/lib/ai/config'
import { generateFashionPhoto } from '@/lib/ai/openai-images'
import { writeListing } from '@/lib/ai/listing-text'
import { parseListingDraft } from '@/lib/ai/listing'
import { buildPhotoPrompt, usesHouseModel, type PhotoSlot } from '@/lib/ai/master-prompt'
import { getImageStorage, saveProductImage, type ImageStorage } from '@/lib/storage/images'
import { WebsiteError } from '@/lib/website/http'
import { SLOT_COUNT, getDraft, isBusy, toDraftDto, type CaptureDraftDto } from './drafts'
import { getHouseModelKey } from './house-model'

export type RunDeps = {
  writeListing: typeof writeListing
  generateFashionPhoto: typeof generateFashionPhoto
  storage: ImageStorage
}

export const defaultDeps = (): RunDeps => ({ writeListing, generateFashionPhoto, storage: getImageStorage() })

const MISSING_TEXT_KEY = 'No AI key set up for the listing text'
const MISSING_PHOTO_KEY = 'OpenAI key not set up'

type Step = { kind: 'listing' } | { kind: 'photo'; slot: PhotoSlot } | { kind: 'done' }

function slotsOf(d: Pick<CaptureDraft, 'imageMode' | 'generatedKeys'>): string[] {
  if (d.imageMode !== 'AI') return []
  return Array.from({ length: SLOT_COUNT }, (_, i) => d.generatedKeys[i] ?? '')
}

function nextStep(d: CaptureDraft): Step {
  if (!d.listing) return { kind: 'listing' }
  const empty = slotsOf(d).findIndex((k) => !k)
  return empty >= 0 ? { kind: 'photo', slot: empty as PhotoSlot } : { kind: 'done' }
}

async function readBytes(storage: ImageStorage, key: string): Promise<Buffer> {
  const stored = await storage.get(key)
  if (!stored) throw new Error('A saved photo is missing. Please add the garment again.')
  return Buffer.from(await new Response(stored.stream).arrayBuffer())
}

function ownerMessage(error: unknown): string {
  const m = error instanceof Error ? error.message.trim() : ''
  return (m || 'Something went wrong. Please try again.').slice(0, 300)
}

/**
 * Do the next step of a draft and return it. A conditional update claims the
 * step (the claim is `busySince`), so two parallel calls never
 * make the same photo: the second just returns the draft as it is.
 */
export async function runNextStep(db: PrismaClient, id: number, deps: RunDeps = defaultDeps()): Promise<CaptureDraftDto> {
  const row = await db.captureDraft.findUnique({ where: { id } })
  if (!row) throw new WebsiteError(404, 'Draft not found')
  if (row.status === 'APPROVED' || row.status === 'REJECTED') {
    throw new WebsiteError(400, `This draft is ${row.status.toLowerCase()}.`)
  }
  const step = nextStep(row)
  if (step.kind === 'done') {
    if (row.status !== 'READY' || row.error) {
      await db.captureDraft.updateMany({ where: { id, updatedAt: row.updatedAt }, data: { status: 'READY', error: null } })
    }
    return (await getDraft(db, id))!
  }
  if (isBusy(row)) return toDraftDto(row)

  const claim = await db.captureDraft.updateMany({
    where: { id, updatedAt: row.updatedAt },
    data: { status: 'GENERATING', error: null, busySince: new Date() },
  })
  if (claim.count === 0) return (await getDraft(db, id))!

  try {
    const data: Prisma.CaptureDraftUpdateInput = {}
    let cost = 0
    let generatedKeys = slotsOf(row)

    if (step.kind === 'listing') {
      if (!aiStatus().text) throw new Error(MISSING_TEXT_KEY)
      const categories = await db.category.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } })
      const references = await Promise.all(row.referenceKeys.map((k) => readBytes(deps.storage, k)))
      const result = await deps.writeListing({
        references,
        categories,
        audience: row.audience,
        notes: row.notes,
        listingType: row.listingType,
      })
      data.listing = result.listing as unknown as Prisma.InputJsonValue
      cost = result.costCents
    } else {
      if (!aiStatus().photos) throw new Error(MISSING_PHOTO_KEY)
      const listing = parseListingDraft(row.listing, [])
      const references = await Promise.all(row.referenceKeys.map((k) => readBytes(deps.storage, k)))
      // Order matters, the prompt names it: garment, then Image 1, then the house model LAST.
      const hasFirstPhoto = step.slot > 0 && Boolean(generatedKeys[0])
      if (hasFirstPhoto) references.push(await readBytes(deps.storage, generatedKeys[0]))
      const houseKey = usesHouseModel(row.audience) ? await getHouseModelKey(db) : null
      if (houseKey) references.push(await readBytes(deps.storage, houseKey))
      const result = await deps.generateFashionPhoto({
        references,
        prompt: buildPhotoPrompt({
          slot: step.slot,
          audience: row.audience,
          notes: row.notes,
          details: listing.details,
          hasFirstPhoto,
          hasHouseModel: Boolean(houseKey),
        }),
      })
      const saved = await saveProductImage(result.png, deps.storage)
      generatedKeys = [...generatedKeys]
      generatedKeys[step.slot] = saved.key
      data.generatedKeys = generatedKeys
      cost = result.costCents
    }

    const listingDone = step.kind === 'listing' || Boolean(row.listing)
    const remaining = !listingDone || generatedKeys.some((k) => !k)
    await db.captureDraft.update({
      where: { id },
      data: { ...data, aiCostCents: { increment: cost }, status: remaining ? 'GENERATING' : 'READY', error: null, busySince: null },
    })
  } catch (error) {
    if (!(error instanceof Error) || ![MISSING_TEXT_KEY, MISSING_PHOTO_KEY].includes(error.message)) {
      console.error('[capture] step failed for draft', id, error instanceof Error ? error.message : error)
    }
    await db.captureDraft.update({ where: { id }, data: { status: 'FAILED', error: ownerMessage(error), busySince: null } })
  }
  return (await getDraft(db, id))!
}

/** Clear one AI photo and queue it to be made again (the next run makes it). */
export async function regenerateSlot(db: PrismaClient, id: number, slot: unknown): Promise<CaptureDraftDto> {
  if (slot !== 0 && slot !== 1 && slot !== 2) throw new WebsiteError(400, 'slot must be 0, 1 or 2', { field: 'slot' })
  const row = await db.captureDraft.findUnique({ where: { id } })
  if (!row) throw new WebsiteError(404, 'Draft not found')
  if (row.imageMode !== 'AI') throw new WebsiteError(400, 'This draft uses your own photos.')
  if (row.status === 'APPROVED' || row.status === 'REJECTED') throw new WebsiteError(400, `This draft is ${row.status.toLowerCase()}.`)
  if (isBusy(row)) throw new WebsiteError(409, 'A photo is being made right now. Try again in a moment.')
  const generatedKeys = slotsOf(row)
  generatedKeys[slot] = ''
  const { count } = await db.captureDraft.updateMany({
    where: { id, updatedAt: row.updatedAt },
    data: { generatedKeys, status: 'GENERATING', error: null },
  })
  if (count === 0) throw new WebsiteError(409, 'Someone else just changed this – try again')
  return (await getDraft(db, id))!
}
