// ZP-490: owner preview of a product page. Server only, UNCACHED.
//
// The product page calls loadPreviewCandidate only when the URL carries a
// `?preview=` token and the slug is not public. The result is used only after
// verifyPreviewTokenFor(token, productId) succeeds for exactly this product.
// Nothing here goes through unstable_cache, so a preview never populates the
// shared storefront cache (the two public entries stay public-only).
//
// The DTO is built by the same allow-list (toPublicProduct): no cost,
// quantity or other private fields. Its pictures point at the signed-in
// image route (/api/images/<hex>.webp), because the public route serves only
// pictures of public products; the owner opening a preview link from the
// back office is signed in on that host.
import { isValidSlug } from '@/lib/storefront-model'
import type { Db } from '@/lib/storefront-model/db'
import { readFewLeftThreshold } from '@/lib/site-settings/db'
import { IMAGE_URL_PREFIX } from '@/lib/storage/keys'
import { toPublicProduct, type PublicProduct, type PublicProductRow } from './dto'
import { PUBLIC_IMAGE_URL_PREFIX } from './image-sizes'
import type { PreviewCandidate } from './product-route'
import { PRODUCT_SELECT } from './queries'

if (typeof window !== 'undefined') throw new Error('src/lib/storefront is server-only')

/** Public image URLs -> the signed-in image route (no width variants there). Pure. */
export function withPreviewImages(product: PublicProduct): PublicProduct {
  return {
    ...product,
    images: product.images.map((image) => ({
      ...image,
      url: image.url.startsWith(PUBLIC_IMAGE_URL_PREFIX)
        ? `${IMAGE_URL_PREFIX}${image.url.slice(PUBLIC_IMAGE_URL_PREFIX.length).replace(/\?.*$/, '')}`
        : image.url,
      srcSet: '',
    })),
  }
}

/** Any product whose CURRENT slug is `slug` (published or not), as a DTO plus its id. */
export async function loadPreviewCandidate(
  db: Db,
  slug: string,
  options: { includeItemNumber?: boolean; now?: Date } = {},
): Promise<PreviewCandidate | null> {
  if (!isValidSlug(slug)) return null
  const [row, fewLeftThreshold] = await Promise.all([
    db.product.findUnique({ where: { slug }, select: PRODUCT_SELECT }) as Promise<PublicProductRow | null>,
    readFewLeftThreshold(db),
  ])
  if (!row) return null
  const product = toPublicProduct(row, {
    now: options.now ?? new Date(),
    fewLeftThreshold,
    includeItemNumber: options.includeItemNumber,
  })
  return { productId: row.id, product: withPreviewImages(product) }
}
