// ZP-1100: AI product capture. OWNER only.
// GET ?status= lists drafts; POST (multipart) creates one.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authorize, OWNER_ONLY } from '@/lib/api-auth'
import { createDraft, listDrafts, OWN_MAX, REFERENCE_MAX } from '@/lib/capture/drafts'
import { IMAGE_MAX_UPLOAD_BYTES } from '@/lib/storage/images'
import { badRequest, errorResponse } from '@/lib/website/http'

export async function GET(request: Request) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response
  try {
    const status = new URL(request.url).searchParams.get('status')
    return NextResponse.json({ drafts: await listDrafts(prisma, status) })
  } catch (error) {
    return errorResponse(error, 'list capture drafts')
  }
}

async function filesOf(form: FormData, name: string, max: number): Promise<Uint8Array[] | string> {
  const files = form.getAll(name).filter((v): v is File => typeof v !== 'string' && v.size > 0)
  if (files.length > max) return `Too many photos (at most ${max}).`
  if (files.some((f) => f.size > IMAGE_MAX_UPLOAD_BYTES)) {
    return `A photo is too large (max ${IMAGE_MAX_UPLOAD_BYTES / 1024 / 1024} MB).`
  }
  return Promise.all(files.map(async (f) => new Uint8Array(await f.arrayBuffer())))
}

export async function POST(request: Request) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return badRequest('Expected a multipart form.')
  }
  const reference = await filesOf(form, 'reference', REFERENCE_MAX)
  if (typeof reference === 'string') return badRequest(reference, 'reference')
  const own = await filesOf(form, 'own', OWN_MAX)
  if (typeof own === 'string') return badRequest(own, 'own')

  const input: Record<string, unknown> = { createdBy: auth.session.username }
  for (const key of ['imageMode', 'listingType', 'unitCostRmb', 'sellingPriceUsd', 'quantity', 'shipFrom', 'shipTo', 'audience', 'notes']) {
    const v = form.get(key)
    if (typeof v === 'string') input[key] = v
  }
  try {
    return NextResponse.json({ draft: await createDraft(prisma, input, { reference, own }) }, { status: 201 })
  } catch (error) {
    return errorResponse(error, 'create capture draft')
  }
}
