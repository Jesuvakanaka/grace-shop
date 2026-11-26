// ZP-1200: import contacts from CSV. OWNER only. Body { csv, fileName?, commit?: boolean, confirmConsent?: boolean }.
// Without commit it only previews. Nobody is opted in unless the file has an explicit consent column AND confirmConsent is true.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { commitImport, previewImport } from '@/lib/marketing/contacts'
import { marketingAuth } from '@/lib/marketing/guard'
import { errorResponse, readJson } from '@/lib/website/http'

export async function POST(request: Request) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  try {
    const body = await readJson(request)
    if (typeof body === 'object' && body !== null && (body as { commit?: unknown }).commit === true) {
      return NextResponse.json(await commitImport(prisma, body, auth.session.username), { status: 201 })
    }
    return NextResponse.json({ plan: await previewImport(prisma, body) })
  } catch (error) {
    return errorResponse(error, 'import contacts')
  }
}
