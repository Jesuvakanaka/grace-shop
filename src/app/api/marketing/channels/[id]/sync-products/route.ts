// ZP-1200: send the product catalogue to Google Merchant Center. OWNER only, behind the go-live gate (assertCanSync).
// Body { mode?: 'products' | 'register-feed' } (default products).
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { marketingAuth } from '@/lib/marketing/guard'
import { syncProducts, SYNC_MODES } from '@/lib/marketing/merchant-sync'
import { asObject, onlyKeys, oneOf } from '@/lib/marketing/validate'
import { badRequest, errorResponse, readJson } from '@/lib/website/http'
import { parseIdParam } from '@/lib/website/validation'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid channel id')
  try {
    const raw = await readJson(request)
    const o = raw === undefined || raw === null ? {} : asObject(raw)
    onlyKeys(o, ['mode'])
    const mode = o.mode === undefined ? 'products' : oneOf(o.mode, 'mode', SYNC_MODES)
    return NextResponse.json({ result: await syncProducts(prisma, id, mode, { username: auth.session.username, role: 'OWNER' }, { fetch: (u, i) => fetch(u, i) }) })
  } catch (error) {
    return errorResponse(error, 'send products to Google Merchant Center')
  }
}
