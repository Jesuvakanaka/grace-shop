// ZP-1119 (MM-14-AC7): accept a piece of advice. Body { key, from?, to? }. Creates a DRAFT campaign only. OWNER only.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { marketingAuth } from '@/lib/marketing/guard'
import { parseRange } from '@/lib/marketing/results'
import { acceptAdvice } from '@/lib/marketing/results-truth-db'
import { errorResponse, readJson } from '@/lib/website/http'
import { asObject } from '@/lib/marketing/validate'

export async function POST(request: Request) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  try {
    const o = asObject(await readJson(request))
    const range = parseRange(typeof o.from === 'string' ? o.from : null, typeof o.to === 'string' ? o.to : null)
    const campaign = await prisma.$transaction((tx) => acceptAdvice(tx, range, o.key, auth.session.username))
    return NextResponse.json({ campaign }, { status: 201 })
  } catch (error) {
    return errorResponse(error, 'accept advice')
  }
}
