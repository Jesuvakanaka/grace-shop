// ZP-483: one gallery photo. OWNER only.
// PATCH { alt?, primary?: true }  DELETE: remove from the gallery.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authorize, OWNER_ONLY } from '@/lib/api-auth'
import { badRequest, errorResponse, readJson } from '@/lib/website/http'
import { deleteGalleryImage, updateGalleryImage } from '@/lib/website/products'
import { revalidateStorefront } from '@/lib/website/revalidate'
import { parseIdParam, parseImagePatch } from '@/lib/website/validation'

type Ctx = { params: Promise<{ id: string; imageId: string }> }

async function ids(params: Ctx['params']) {
  const p = await params
  return { id: parseIdParam(p.id), imageId: parseIdParam(p.imageId) }
}

export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response
  const { id, imageId } = await ids(params)
  if (!id || !imageId) return badRequest('Invalid id')
  const parsed = parseImagePatch(await readJson(request))
  if (!parsed.ok) return badRequest(parsed.error, parsed.field)
  try {
    const { slug, images } = await updateGalleryImage(prisma, id, imageId, parsed.data)
    revalidateStorefront({ productSlugs: [slug] })
    return NextResponse.json({ images })
  } catch (error) {
    return errorResponse(error, 'update gallery image')
  }
}

export async function DELETE(request: Request, { params }: Ctx) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response
  const { id, imageId } = await ids(params)
  if (!id || !imageId) return badRequest('Invalid id')
  try {
    const { slug, images } = await deleteGalleryImage(prisma, id, imageId)
    revalidateStorefront({ productSlugs: [slug] })
    return NextResponse.json({ images })
  } catch (error) {
    return errorResponse(error, 'delete gallery image')
  }
}
