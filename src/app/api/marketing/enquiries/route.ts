// ZP-1116 (MM-11): enquiries the owner recorded or a connected inbox saw. OWNER only (hub guard).
// GET ?status=OPEN|NEW|…&due=1&q= lists them, with taps and conversations counted apart for ?from&to (MM-11-AC1).
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { createEnquiry, enquiryCounts, listEnquiries } from '@/lib/marketing/enquiries'
import { marketingAuth } from '@/lib/marketing/guard'
import { errorResponse, readJson, WebsiteError } from '@/lib/website/http'

const day = (v: string | null, fallback: Date) => {
  if (!v) return fallback
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new WebsiteError(400, 'Dates are YYYY-MM-DD.')
  return new Date(`${v}T00:00:00`)
}

export async function GET(request: Request) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  try {
    const p = new URL(request.url).searchParams
    const to = day(p.get('to'), new Date())
    const from = day(p.get('from'), new Date(to.getTime() - 29 * 86_400_000))
    to.setHours(23, 59, 59, 999)
    const enquiries = await listEnquiries(prisma, { status: p.get('status') ?? undefined, due: p.get('due') === '1', q: p.get('q') ?? undefined })
    return NextResponse.json({ enquiries, counts: await enquiryCounts(prisma, { from, to }) })
  } catch (error) {
    return errorResponse(error, 'list enquiries')
  }
}

export async function POST(request: Request) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  try {
    const body = await readJson(request)
    return NextResponse.json({ enquiry: await prisma.$transaction((tx) => createEnquiry(tx, body, auth.session.username)) }, { status: 201 })
  } catch (error) {
    return errorResponse(error, 'record enquiry')
  }
}
