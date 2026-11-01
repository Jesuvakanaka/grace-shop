'use server'

// ZP-510: the feed's details sheet loads a piece's extras (description,
// options, ref, top reviews, store visit) once per slug through this server
// action. A server action is a public POST endpoint, so the argument is
// checked; it only reads the cached public catalogue, reviews index and site
// settings (./feed-sheet-data.ts) and returns the public SheetExtras DTO.
import { isValidSlug } from '@/lib/storefront-model/slug'
import type { SheetExtras } from './feed-sheet'
import { loadSheetExtras } from './feed-sheet-data'

export async function loadSheetExtrasAction(slug: unknown): Promise<SheetExtras | null> {
  if (!isValidSlug(slug)) return null
  return loadSheetExtras(slug)
}
