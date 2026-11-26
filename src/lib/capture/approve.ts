// Approve a draft: create the Product, gallery and website fields (ZP-1100). Server only.
import type { PrismaClient } from '@prisma/client'
import { parseListingDraft } from '@/lib/ai/listing'
import { publishProduct } from '@/lib/storefront-model/db'
import { imageUrlForKey } from '@/lib/storage/keys'
import { GALLERY_MAX_IMAGES } from '@/lib/website/labels'
import { WebsiteError } from '@/lib/website/http'
import { isBusy, SLOT_COUNT } from './drafts'

export type ApproveResult = {
  productId: number
  published: boolean
  slug: string | null
  missing?: string[]
}

export async function approveDraft(
  db: PrismaClient,
  id: number,
  opts: { publish: boolean; itemNumber?: string | null; username?: string },
): Promise<ApproveResult> {
  const itemNumberRaw = opts.itemNumber?.trim()
  if (itemNumberRaw && itemNumberRaw.length > 60) throw new WebsiteError(400, 'The item number is too long.', { field: 'itemNumber' })

  const productId = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "CaptureDraft" WHERE id = ${id} FOR UPDATE`
    const draft = await tx.captureDraft.findUnique({ where: { id } })
    if (!draft) throw new WebsiteError(404, 'Draft not found')
    if (draft.status === 'APPROVED') throw new WebsiteError(400, 'This draft is already approved.')
    if (draft.status === 'REJECTED') throw new WebsiteError(400, 'This draft was rejected.')
    if (isBusy(draft)) throw new WebsiteError(409, 'A step is still running. Try again in a moment.')
    if (!draft.listing) throw new WebsiteError(400, 'The listing is not written yet.')
    const categoryIds = (await tx.category.findMany({ select: { id: true } })).map((c) => c.id)
    const listing = parseListingDraft(draft.listing, categoryIds)
    if (!listing.publicName) throw new WebsiteError(400, 'The listing needs a name.')

    const generated = draft.generatedKeys.slice(0, SLOT_COUNT)
    if (draft.imageMode === 'AI' && (generated.length < SLOT_COUNT || generated.some((k) => !k))) {
      throw new WebsiteError(400, 'The model photos are not all ready yet.')
    }
    const keys = [...new Set([...(draft.imageMode === 'AI' ? generated : draft.ownKeys), ...draft.referenceKeys])]
    if (keys.length > GALLERY_MAX_IMAGES) throw new WebsiteError(400, `At most ${GALLERY_MAX_IMAGES} photos per product.`)
    const aiKeys = new Set(draft.imageMode === 'AI' ? generated : [])

    const itemNumber = itemNumberRaw || `CAP-${draft.id}`
    if (await tx.product.findUnique({ where: { itemNumber }, select: { id: true } })) {
      throw new WebsiteError(400, `Item number ${itemNumber} is already used.`, { field: 'itemNumber' })
    }

    const rate = await tx.exchangeRate.findFirst({ orderBy: { effectiveDate: 'desc' } })
    const unitCostRmb = draft.unitCostRmb ?? 0
    const unitCostUsd = rate ? Math.round(unitCostRmb * rate.rmbToUsd * 100) / 100 : 0
    const sellingPriceUsd = draft.sellingPriceUsd ?? 0
    const inStock = draft.listingType === 'IN_STOCK'
    const qty = inStock ? draft.quantity : 0

    const product = await tx.product.create({
      data: {
        itemNumber,
        productName: listing.publicName,
        imageUrl: imageUrlForKey(keys[0]),
        unitCostRmb,
        unitCostUsd,
        sellingPriceRmb: 0,
        sellingPriceUsd,
        openingQuantity: qty,
        currentQuantity: qty,
        createdBy: opts.username,
        publicName: listing.publicName,
        publicDescription: listing.description || null,
        categoryId: listing.categoryId,
        colours: listing.colours,
        sizes: listing.sizes,
        fabric: listing.fabric,
        care: listing.care,
        priceDisplay: sellingPriceUsd > 0 ? 'SHOW_PRICE' : 'ASK_FOR_PRICE',
        listingType: draft.listingType,
        ...(inStock
          ? {}
          : { preorderShipFrom: draft.shipFrom, preorderShipTo: draft.shipTo, preorderExpectedQty: draft.quantity }),
      },
    })
    if (qty > 0) {
      await tx.stockMovement.create({
        data: {
          productId: product.id,
          movementDate: new Date(),
          movementType: 'OPENING_BALANCE',
          quantity: qty,
          openingBalance: 0,
          closingBalance: qty,
          notes: 'Initial opening stock',
          referenceType: 'MANUAL',
          createdBy: opts.username,
        },
      })
    }
    for (const [index, imageKey] of keys.entries()) {
      await tx.productImage.create({
        data: {
          productId: product.id,
          imageKey,
          alt: listing.altText || null,
          sortOrder: index,
          isPrimary: index === 0,
          aiGenerated: aiKeys.has(imageKey),
        },
      })
    }
    await tx.captureDraft.update({ where: { id }, data: { status: 'APPROVED', productId: product.id, error: null } })
    return product.id
  })

  if (!opts.publish) return { productId, published: false, slug: null }
  const result = await publishProduct(db, productId, { publish: true })
  if (!result.ok) return { productId, published: false, slug: null, missing: result.missing }
  return { productId, published: result.published, slug: result.slug }
}
