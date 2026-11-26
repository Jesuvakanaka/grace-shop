// AI capture drafts: create, list, read, edit, reject (ZP-1100). Server only.
// See docs/storefront/ai-capture.md.
import type { CaptureDraft, Prisma, PrismaClient } from '@prisma/client'
import { parseListingDraft, type ListingDraft } from '@/lib/ai/listing'
import { WebsiteError } from '@/lib/website/http'
import { getImageStorage, ImageRejectedError, imageUrlForKey, saveProductImage, type ImageStorage } from '@/lib/storage/images'

export const REFERENCE_MAX = 3
export const OWN_MAX = 6
export const SLOT_COUNT = 3
/** A claim older than this is abandoned (request limit is 300 s). */
export const BUSY_STALE_MS = 6 * 60_000

export const LISTING_TYPES = ['IN_STOCK', 'PRE_ORDER'] as const
export const IMAGE_MODES = ['AI', 'OWN'] as const
export const CAPTURE_STATUSES = ['NEW', 'GENERATING', 'READY', 'APPROVED', 'REJECTED', 'FAILED'] as const

/** A step is running (busySince set and not stale). */
export function isBusy(draft: Pick<CaptureDraft, 'busySince'>, now = Date.now()): boolean {
  return draft.busySince !== null && now - draft.busySince.getTime() < BUSY_STALE_MS
}

export type CaptureDraftDto = {
  id: number
  status: CaptureDraft['status']
  imageMode: CaptureDraft['imageMode']
  listingType: CaptureDraft['listingType']
  photos: { reference: string[]; own: string[]; generated: (string | null)[] }
  unitCostRmb: number | null
  sellingPriceUsd: number | null
  quantity: number
  shipFrom: string | null
  shipTo: string | null
  audience: string | null
  notes: string | null
  listing: ListingDraft | null
  error: string | null
  /** An AI step is running right now. */
  busy: boolean
  aiCostCents: number
  productId: number | null
  createdAt: Date
  updatedAt: Date
}

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)

export function toDraftDto(d: CaptureDraft): CaptureDraftDto {
  return {
    id: d.id,
    status: d.status,
    imageMode: d.imageMode,
    listingType: d.listingType,
    photos: {
      reference: d.referenceKeys.map(imageUrlForKey),
      own: d.ownKeys.map(imageUrlForKey),
      generated: d.generatedKeys.map((k) => (k ? imageUrlForKey(k) : null)),
    },
    unitCostRmb: d.unitCostRmb,
    sellingPriceUsd: d.sellingPriceUsd,
    quantity: d.quantity,
    shipFrom: day(d.shipFrom),
    shipTo: day(d.shipTo),
    audience: d.audience,
    notes: d.notes,
    listing: (d.listing as ListingDraft | null) ?? null,
    error: d.error,
    busy: isBusy(d),
    aiCostCents: d.aiCostCents,
    productId: d.productId,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  }
}

// ─── Validation of the scalar fields (create and edit) ────────────────────────

type Scalars = {
  imageMode?: 'AI' | 'OWN'
  listingType?: 'IN_STOCK' | 'PRE_ORDER'
  unitCostRmb?: number | null
  sellingPriceUsd?: number | null
  quantity?: number
  shipFrom?: Date | null
  shipTo?: Date | null
  audience?: string | null
  notes?: string | null
}

const bad = (message: string, field?: string) => new WebsiteError(400, message, field ? { field } : {})

function blank(v: unknown) {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
}

function money(v: unknown, field: string): number | null {
  if (blank(v)) return null
  const n = typeof v === 'number' ? v : Number(String(v).trim())
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) throw bad('Enter an amount of 0 or more.', field)
  return Math.round(n * 100) / 100
}

function dateOnly(v: unknown, field: string): Date | null {
  if (blank(v)) return null
  const s = String(v).trim()
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00.000Z`) : null
  if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw bad('Enter a date as YYYY-MM-DD.', field)
  return d
}

function text(v: unknown, max: number, field: string): string | null {
  if (blank(v)) return null
  if (typeof v !== 'string') throw bad('Enter text.', field)
  return v.trim().slice(0, max)
}

/** Only the listed fields are read; anything else in `raw` is ignored. */
export function parseScalars(raw: Record<string, unknown>, opts: { allowImageMode?: boolean } = {}): Scalars {
  const out: Scalars = {}
  if (opts.allowImageMode && raw.imageMode !== undefined) {
    if (!(IMAGE_MODES as readonly unknown[]).includes(raw.imageMode)) throw bad('Choose AI photos or your own photos.', 'imageMode')
    out.imageMode = raw.imageMode as 'AI' | 'OWN'
  }
  if (raw.listingType !== undefined) {
    if (!(LISTING_TYPES as readonly unknown[]).includes(raw.listingType)) throw bad('Choose in stock or pre-order.', 'listingType')
    out.listingType = raw.listingType as 'IN_STOCK' | 'PRE_ORDER'
  }
  if (raw.unitCostRmb !== undefined) out.unitCostRmb = money(raw.unitCostRmb, 'unitCostRmb')
  if (raw.sellingPriceUsd !== undefined) out.sellingPriceUsd = money(raw.sellingPriceUsd, 'sellingPriceUsd')
  if (raw.quantity !== undefined) {
    const n = typeof raw.quantity === 'number' ? raw.quantity : Number(String(raw.quantity).trim())
    if (!Number.isInteger(n) || n < 1 || n > 100_000) throw bad('Quantity must be a whole number of 1 or more.', 'quantity')
    out.quantity = n
  }
  if (raw.shipFrom !== undefined) out.shipFrom = dateOnly(raw.shipFrom, 'shipFrom')
  if (raw.shipTo !== undefined) out.shipTo = dateOnly(raw.shipTo, 'shipTo')
  if (raw.audience !== undefined) out.audience = text(raw.audience, 100, 'audience')
  if (raw.notes !== undefined) out.notes = text(raw.notes, 1000, 'notes')
  return out
}

function checkShipWindow(from: Date | null | undefined, to: Date | null | undefined) {
  if (from && to && to < from) throw bad('The ship window ends before it starts.', 'shipTo')
}

// ─── Create ───────────────────────────────────────────────────────────────────

export type CreateDraftInput = Record<string, unknown> & { createdBy?: string }
export type CreateDraftFiles = { reference: Uint8Array[]; own: Uint8Array[] }

async function storeAll(files: Uint8Array[], storage: ImageStorage): Promise<string[]> {
  const keys: string[] = []
  for (const f of files) {
    try {
      keys.push((await saveProductImage(f, storage)).key)
    } catch (error) {
      if (error instanceof ImageRejectedError) throw bad(error.message)
      throw error
    }
  }
  return keys
}

export async function createDraft(
  db: PrismaClient,
  input: CreateDraftInput,
  files: CreateDraftFiles,
  storage: ImageStorage = getImageStorage(),
): Promise<CaptureDraftDto> {
  const fields = parseScalars(input, { allowImageMode: true })
  const imageMode = fields.imageMode ?? 'AI'
  if (files.reference.length < 1 || files.reference.length > REFERENCE_MAX) {
    throw bad(`Add 1 to ${REFERENCE_MAX} photos of the garment.`, 'reference')
  }
  if (imageMode === 'OWN' && (files.own.length < 1 || files.own.length > OWN_MAX)) {
    throw bad(`Add 1 to ${OWN_MAX} finished photos.`, 'own')
  }
  if (imageMode === 'AI' && files.own.length > 0) throw bad('Finished photos are only used with "my own photos".', 'own')
  checkShipWindow(fields.shipFrom, fields.shipTo)

  const referenceKeys = await storeAll(files.reference, storage)
  const ownKeys = await storeAll(files.own, storage)
  const row = await db.captureDraft.create({
    data: {
      imageMode,
      listingType: fields.listingType ?? 'IN_STOCK',
      referenceKeys,
      ownKeys,
      generatedKeys: imageMode === 'AI' ? Array(SLOT_COUNT).fill('') : [],
      unitCostRmb: fields.unitCostRmb ?? null,
      sellingPriceUsd: fields.sellingPriceUsd ?? null,
      quantity: fields.quantity ?? 1,
      shipFrom: fields.shipFrom ?? null,
      shipTo: fields.shipTo ?? null,
      audience: fields.audience ?? null,
      notes: fields.notes ?? null,
      createdBy: input.createdBy ?? null,
    },
  })
  return toDraftDto(row)
}

// ─── Read ─────────────────────────────────────────────────────────────────────

export async function listDrafts(db: PrismaClient, status?: string | null): Promise<CaptureDraftDto[]> {
  if (status && !(CAPTURE_STATUSES as readonly string[]).includes(status)) throw bad('Unknown status.', 'status')
  const rows = await db.captureDraft.findMany({
    where: status ? { status: status as CaptureDraft['status'] } : {},
    orderBy: { id: 'desc' },
    take: 200,
  })
  return rows.map(toDraftDto)
}

export async function getDraft(db: PrismaClient, id: number): Promise<CaptureDraftDto | null> {
  const row = await db.captureDraft.findUnique({ where: { id } })
  return row ? toDraftDto(row) : null
}

// ─── Edit and reject ──────────────────────────────────────────────────────────

/** Edit with an allow-list. Refused once the draft is APPROVED. */
export async function updateDraft(db: PrismaClient, id: number, patch: unknown): Promise<CaptureDraftDto> {
  const raw = (patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : null) as Record<string, unknown> | null
  if (!raw) throw bad('Send a JSON object.')
  const current = await db.captureDraft.findUnique({ where: { id } })
  if (!current) throw new WebsiteError(404, 'Draft not found')
  if (current.status === 'APPROVED') throw bad('This draft is already approved. Edit the product instead.')

  const fields = parseScalars(raw)
  checkShipWindow(fields.shipFrom ?? current.shipFrom, fields.shipTo ?? current.shipTo)
  const data: Prisma.CaptureDraftUpdateManyMutationInput = { ...fields }
  if (raw.listing !== undefined) {
    const categories = await db.category.findMany({ select: { id: true } })
    const listing = parseListingDraft(raw.listing, categories.map((c) => c.id))
    if (!listing.publicName) throw bad('The listing needs a name.', 'listing')
    data.listing = listing as unknown as Prisma.InputJsonValue
  }
  const { count } = await db.captureDraft.updateMany({ where: { id, status: { not: 'APPROVED' } }, data })
  if (count === 0) throw bad('This draft is already approved. Edit the product instead.')
  return (await getDraft(db, id))!
}

export async function rejectDraft(db: PrismaClient, id: number): Promise<CaptureDraftDto> {
  const { count } = await db.captureDraft.updateMany({
    where: { id, status: { not: 'APPROVED' } },
    data: { status: 'REJECTED' },
  })
  const draft = await getDraft(db, id)
  if (!draft) throw new WebsiteError(404, 'Draft not found')
  if (count === 0) throw bad('An approved draft cannot be rejected.')
  return draft
}
