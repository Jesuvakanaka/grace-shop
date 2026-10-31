// ZP-483: product photo gallery. OWNER only.
// POST { urls }: add pictures already uploaded through POST /api/upload.
// PUT { order }: reorder the whole gallery; the first photo becomes primary.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authorize, OWNER_ONLY } from '@/lib/api-auth'
import { GALLERY_MAX_IMAGES } from '@/lib/website/labels'
import { badRequest, errorResponse, readJson } from '@/lib/website/http'
import { addGalleryImages, reorderGallery } from '@/lib/website/products'
import { revalidateStorefront } from '@/lib/website/revalidate'
import { parseIdParam, parseImageUrls, parseOrderBody } from '@/lib/website/validation'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Ctx) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid product id')
  const parsed = parseImageUrls(await readJson(request))
  if (!parsed.ok) return badRequest(parsed.error)
  try {
    const { slug, images } = await addGalleryImages(prisma, id, parsed.data)
    revalidateStorefront({ productSlugs: [slug] })
    return NextResponse.json({ images })
  } catch (error) {
    return errorResponse(error, 'add gallery images')
  }
}

export async function PUT(request: Request, { params }: Ctx) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid product id')
  const parsed = parseOrderBody(await readJson(request), GALLERY_MAX_IMAGES)
  if (!parsed.ok) return badRequest(parsed.error)
  try {
    const { slug, images } = await reorderGallery(prisma, id, parsed.data)
    revalidateStorefront({ productSlugs: [slug] })
    return NextResponse.json({ images })
  } catch (error) {
    return errorResponse(error, 'reorder gallery')
  }
}
