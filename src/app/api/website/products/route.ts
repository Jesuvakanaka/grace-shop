// ZP-483: website status of every product (Published / Draft / Not ready). OWNER only.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authorize, OWNER_ONLY } from '@/lib/api-auth'
import { errorResponse } from '@/lib/website/http'
import { listWebsiteStatus } from '@/lib/website/products'

export async function GET(request: Request) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response
  try {
    return NextResponse.json(await listWebsiteStatus(prisma))
  } catch (error) {
    return errorResponse(error, 'list website status')
  }
}
