// Admin website tools for categories (ZP-483). Server only.
import type { Prisma, PrismaClient } from '@prisma/client'
import { isReservedSlug, slugify, uniqueSlug } from '@/lib/storefront-model'
import { getImageStorage, imageUrlForKey } from '@/lib/storage/images'
import { WebsiteError } from './http'
import type { CategoryInput } from './validation'

type Tx = Prisma.TransactionClient

/** Most categories the admin manages (the reorder list must fit in one request). */
export const CATEGORY_MAX = 200

type CategoryRow = {
  id: number
  name: string
  slug: string
  description: string | null
  heroImageKey: string | null
  sortOrder: number
  published: boolean
  _count?: { products: number }
}

function toDto(c: CategoryRow) {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    description: c.description,
    heroImageKey: c.heroImageKey,
    heroImageUrl: c.heroImageKey ? imageUrlForKey(c.heroImageKey) : null,
    sortOrder: c.sortOrder,
    published: c.published,
    productCount: c._count?.products ?? 0,
  }
}

const withCount = { _count: { select: { products: true } } } as const

export async function listCategories(db: PrismaClient | Tx) {
  const rows = await db.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], include: withCount })
  return rows.map(toDto)
}

/** A slug typed by the owner: normalised, not reserved, not used by another category. */
async function checkTypedSlug(tx: Tx, raw: string, categoryId: number | null): Promise<string> {
  const slug = slugify(raw)
  if (!slug) throw new WebsiteError(400, 'Slug must contain at least one letter or digit', { field: 'slug' })
  if (isReservedSlug(slug)) {
    throw new WebsiteError(400, `Slug "${slug}" is reserved for the website; choose another (e.g. "${slug}-1")`, { field: 'slug' })
  }
  const other = await tx.category.findUnique({ where: { slug }, select: { id: true } })
  if (other && other.id !== categoryId) {
    throw new WebsiteError(400, `Slug "${slug}" is already used by another category`, { field: 'slug' })
  }
  return slug
}

async function generatedSlug(tx: Tx, name: string): Promise<string> {
  const root = slugify(name) || 'category'
  const taken = new Set(
    (await tx.category.findMany({ where: { slug: { startsWith: root } }, select: { slug: true } })).map((c) => c.slug),
  )
  return uniqueSlug(root, (s) => taken.has(s))
}

async function checkHeroImage(key: string | null | undefined) {
  if (key && !(await getImageStorage().exists(key))) {
    throw new WebsiteError(400, 'The photo was not found. Please upload it again.', { field: 'heroImageUrl' })
  }
}

export async function createCategory(db: PrismaClient, input: CategoryInput) {
  await checkHeroImage(input.heroImageKey)
  return db.$transaction(async (tx) => {
    if ((await tx.category.count()) >= CATEGORY_MAX) throw new WebsiteError(400, `At most ${CATEGORY_MAX} categories.`)
    const slug = input.slug !== undefined ? await checkTypedSlug(tx, input.slug, null) : await generatedSlug(tx, input.name!)
    const last = await tx.category.aggregate({ _max: { sortOrder: true } })
    const row = await tx.category.create({
      data: {
        name: input.name!,
        slug,
        description: input.description ?? null,
        heroImageKey: input.heroImageKey ?? null,
        published: input.published ?? false,
        sortOrder: (last._max.sortOrder ?? -1) + 1,
      },
      include: withCount,
    })
    return toDto(row)
  })
}

export async function updateCategory(db: PrismaClient, id: number, input: CategoryInput) {
  await checkHeroImage(input.heroImageKey)
  return db.$transaction(async (tx) => {
    const current = await tx.category.findUnique({ where: { id }, select: { slug: true } })
    if (!current) throw new WebsiteError(404, 'Category not found')
    const data: Prisma.CategoryUpdateInput = {}
    if (input.name !== undefined) data.name = input.name
    if (input.slug !== undefined) data.slug = await checkTypedSlug(tx, input.slug, id)
    if (input.description !== undefined) data.description = input.description
    if (input.heroImageKey !== undefined) data.heroImageKey = input.heroImageKey
    if (input.published !== undefined) data.published = input.published
    const row = await tx.category.update({ where: { id }, data, include: withCount })
    return { oldSlug: current.slug, category: toDto(row) }
  })
}

/** `order` must list every category once. */
export async function reorderCategories(db: PrismaClient, order: readonly number[]) {
  return db.$transaction(async (tx) => {
    const ids = new Set((await tx.category.findMany({ select: { id: true } })).map((c) => c.id))
    if (order.length !== ids.size || !order.every((id) => ids.has(id))) {
      throw new WebsiteError(400, 'The category list is out of date. Reload and try again.')
    }
    for (const [index, id] of order.entries()) await tx.category.update({ where: { id }, data: { sortOrder: index } })
    return listCategories(tx)
  })
}

export function moveProductsFirstMessage(count: number): string {
  return `Move ${count} ${count === 1 ? 'product' : 'products'} first`
}

/** Only an empty category can be deleted. A product added meanwhile makes Postgres refuse (P2003 -> 409). */
export async function deleteCategory(db: PrismaClient, id: number) {
  return db.$transaction(async (tx) => {
    const category = await tx.category.findUnique({ where: { id }, include: withCount })
    if (!category) throw new WebsiteError(404, 'Category not found')
    const count = category._count.products
    if (count > 0) throw new WebsiteError(409, moveProductsFirstMessage(count), { productCount: count })
    await tx.category.delete({ where: { id } })
    return { slug: category.slug }
  })
}
