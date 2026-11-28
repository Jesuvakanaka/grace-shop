// VYRA Marketing Manager (ZP-1106, MM-01): the existing catalogue as marketing sees it. Server only.
// Every row is the Product itself, by its stable id (MM-01-AC1): nothing is copied or imported into a second list.
import { WebsiteError } from '@/lib/website/http'
import type { Db } from './audit'
import { getSettings } from './settings'
import { availabilityOf, productBlockReason, truthFacts, truthLines, wholesaleOffer, wholesaleText, type Availability, type TruthFacts, type TruthProduct } from './product-truth'

const TRUTH_SELECT = {
  id: true, productName: true, publicName: true, published: true, listingType: true, currentQuantity: true,
  preorderShipFrom: true, preorderShipTo: true, wholesalePriceUsd: true, wholesaleMinQuantity: true,
} as const

export interface CatalogueRow {
  productId: number
  name: string
  availability: Availability
  /** Why it is not marketed right now (withdrawn, sold out), or null. */
  excluded: string | null
  /** The wholesale offer as the shop would say it, or why it cannot be said. */
  wholesale: { text: string } | { reason: string }
  profile: { exists: boolean; aiGenerated: boolean; confirmedBy: string | null; confirmedAt: Date | null }
}

/**
 * The catalogue with each product's truth. Published products by default; `includeWithdrawn` adds the
 * unpublished ones (shown as excluded, never marketed).
 */
export async function listCatalogue(db: Db, opts: { includeWithdrawn?: boolean; limit?: number } = {}): Promise<CatalogueRow[]> {
  const settings = await getSettings(db)
  const rows = await db.product.findMany({
    where: opts.includeWithdrawn ? {} : { published: true },
    select: { ...TRUTH_SELECT, marketingSellingProfile: { select: { aiGenerated: true, confirmedBy: true, confirmedAt: true } } },
    orderBy: { id: 'desc' },
    take: Math.min(Math.max(opts.limit ?? 200, 1), 500),
  })
  return rows.map((p) => {
    const w = wholesaleOffer(p, settings.salesMode)
    return {
      productId: p.id,
      name: p.publicName?.trim() || p.productName,
      availability: availabilityOf(p),
      excluded: productBlockReason(p),
      wholesale: w.ok ? { text: wholesaleText(w) } : { reason: w.reason },
      profile: {
        exists: Boolean(p.marketingSellingProfile),
        aiGenerated: p.marketingSellingProfile?.aiGenerated ?? false,
        confirmedBy: p.marketingSellingProfile?.confirmedBy ?? null,
        confirmedAt: p.marketingSellingProfile?.confirmedAt ?? null,
      },
    }
  })
}

export interface ProductTruth {
  product: TruthProduct
  facts: TruthFacts
  lines: string[]
  wholesaleText: string | null
  blockReason: string | null
}

/** The truth of one product right now (null when it no longer exists). */
export async function productTruth(db: Db, productId: number): Promise<ProductTruth | null> {
  const product = await db.product.findUnique({ where: { id: productId }, select: TRUTH_SELECT })
  if (!product) return null
  const settings = await getSettings(db)
  const shop = { delivery: settings.policyDelivery, returns: settings.policyReturns, ordering: settings.policyOrdering, salesMode: settings.salesMode }
  const facts = truthFacts(product, shop)
  return {
    product,
    facts,
    lines: truthLines(product, shop),
    wholesaleText: facts.wholesale.ok ? wholesaleText(facts.wholesale) : null,
    blockReason: productBlockReason(product),
  }
}

/** 409 with a plain reason when the product may not be marketed now (MM-01-AC4, AT-06). No product = nothing to check. */
export async function assertProductMarketable(db: Db, productId: number | null | undefined): Promise<void> {
  if (!productId) return
  const t = await productTruth(db, productId)
  if (!t) throw new WebsiteError(409, 'The product of this post no longer exists, so it cannot go out.', { blocked: 'product' })
  if (t.blockReason) throw new WebsiteError(409, t.blockReason, { blocked: 'product' })
}

/** Why the product of this content may not go out now, or null (no product, or a marketable one). */
export async function contentProductBlockReason(db: Db, contentId: number): Promise<string | null> {
  const c = await db.marketingContent.findUnique({ where: { id: contentId }, select: { productId: true } })
  if (!c?.productId) return null
  const t = await productTruth(db, c.productId)
  if (!t) return 'The product of this post no longer exists, so it cannot go out.'
  return t.blockReason
}

/** 409 when the content's product may not go out now (withdrawn, sold out). Checked before every dispatch. */
export async function assertContentProductMarketable(db: Db, contentId: number): Promise<void> {
  const reason = await contentProductBlockReason(db, contentId)
  if (reason) throw new WebsiteError(409, reason, { blocked: 'product' })
}

/** Refuse newly chosen products that are withdrawn or sold out (already chosen ones are left as they are). */
export async function assertNewProductsMarketable(db: Db, ids: number[]): Promise<void> {
  if (ids.length === 0) return
  const rows = await db.product.findMany({ where: { id: { in: ids } }, select: TRUTH_SELECT })
  for (const p of rows) {
    const reason = productBlockReason(p)
    if (reason) throw new WebsiteError(400, reason, { field: 'productIds' })
  }
}
