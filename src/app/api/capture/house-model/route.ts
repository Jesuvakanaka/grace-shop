// AI capture house model photo. OWNER only. GET -> { url }; PUT (multipart "photo") -> { url }; DELETE -> { url: null }.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authorize, OWNER_ONLY } from '@/lib/api-auth'
import { clearHouseModel, getHouseModel, setHouseModel } from '@/lib/capture/house-model'
import { IMAGE_MAX_UPLOAD_BYTES } from '@/lib/storage/images'
import { badRequest, errorResponse } from '@/lib/website/http'

export async function GET(request: Request) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response
  try {
    return NextResponse.json(await getHouseModel(prisma))
  } catch (error) {
    return errorResponse(error, 'read house model')
  }
}

export async function PUT(request: Request) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return badRequest('Expected a multipart form.')
  }
  const file = form.get('photo')
  if (typeof file === 'string' || !file || file.size === 0) return badRequest('Choose a photo.', 'photo')
  if (file.size > IMAGE_MAX_UPLOAD_BYTES) {
    return badRequest(`The photo is too large (max ${IMAGE_MAX_UPLOAD_BYTES / 1024 / 1024} MB).`, 'photo')
  }
  try {
    return NextResponse.json(await setHouseModel(prisma, new Uint8Array(await file.arrayBuffer())))
  } catch (error) {
    return errorResponse(error, 'set house model')
  }
}

export async function DELETE(request: Request) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response
  try {
    await clearHouseModel(prisma)
    return NextResponse.json({ url: null })
  } catch (error) {
    return errorResponse(error, 'remove house model')
  }
}
