// VYRA Marketing hub (ZP-1200): published products with their photos, for the content and campaign pickers. Server only.
import type { Db } from './audit'
import { imageUrlForKey } from '@/lib/storage/keys'

export interface PickerProduct {
  id: number
  name: string
  slug: string | null
  photos: { imageKey: string; url: string; isPrimary: boolean }[]
}

/** Clean a search box value: trimmed, at most 80 characters. */
export const cleanQuery = (q: string | null | undefined): string => (q ?? '').trim().slice(0, 80)

export async function searchPublishedProducts(db: Db, q: string | null | undefined, opts: { ids?: number[]; limit?: number } = {}): Promise<PickerProduct[]> {
  const term = cleanQuery(q)
  const ids = opts.ids ?? []
  const rows = await db.product.findMany({
    where: {
      OR: [
        ...(ids.length > 0 ? [{ id: { in: ids } }] : []),
        {
          published: true,
          ...(term ? { OR: [{ productName: { contains: term, mode: 'insensitive' as const } }, { publicName: { contains: term, mode: 'insensitive' as const } }, { itemNumber: { contains: term, mode: 'insensitive' as const } }] } : {}),
        },
      ],
    },
    select: { id: true, productName: true, publicName: true, slug: true, images: { orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }], select: { imageKey: true, isPrimary: true } } },
    orderBy: { id: 'desc' },
    take: Math.min(Math.max(opts.limit ?? 30, 1), 100),
  })
  return rows.map((p) => ({
    id: p.id,
    name: p.publicName || p.productName,
    slug: p.slug,
    photos: p.images.filter((i) => /^products\/[a-f0-9]{32}\.webp$/.test(i.imageKey)).map((i) => ({ imageKey: i.imageKey, url: imageUrlForKey(i.imageKey), isPrimary: i.isPrimary })),
  }))
}
