// Marketing hub: a product's selling profile (who buys it, why, what stops them) and the
// reasons to act now that are true for it today. OWNER only.
// GET ?campaignId= reads; POST asks the AI to work the profile out; PUT saves the owner's corrections.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { urgencyOptions } from '@/lib/marketing/brief'
import { marketingAuth } from '@/lib/marketing/guard'
import { generateProfile, getProfile, saveProfile } from '@/lib/marketing/selling-profile'
import { getSettings } from '@/lib/marketing/settings'
import { WebsiteError, badRequest, errorResponse, notFound, readJson } from '@/lib/website/http'
import { parseIdParam } from '@/lib/website/validation'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid product id')
  try {
    const product = await prisma.product.findUnique({
      where: { id },
      select: { published: true, publishedAt: true, currentQuantity: true, listingType: true, preorderShipFrom: true },
    })
    if (!product) return notFound('Product')
    const campaignId = parseIdParam(new URL(request.url).searchParams.get('campaignId') ?? '')
    const campaign = campaignId ? await prisma.marketingCampaign.findUnique({ where: { id: campaignId }, select: { name: true, endsAt: true } }) : null
    const settings = await getSettings(prisma)
    return NextResponse.json({
      profile: await getProfile(prisma, id),
      urgency: urgencyOptions(product, campaign),
      policiesOnFile: Boolean(settings.policyDelivery || settings.policyReturns || settings.policyOrdering),
    })
  } catch (error) {
    return errorResponse(error, 'get selling profile')
  }
}

export async function POST(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid product id')
  try {
    return NextResponse.json({ profile: await generateProfile(prisma, id, auth.session.username) })
  } catch (error) {
    if (error instanceof WebsiteError) return errorResponse(error, 'write selling profile')
    console.error('[marketing] selling profile failed:', error)
    return NextResponse.json({ error: 'The AI could not work out the selling profile. Try again in a moment.' }, { status: 502 })
  }
}

export async function PUT(request: Request, { params }: Ctx) {
  const auth = await marketingAuth(request)
  if (!auth.ok) return auth.response
  const id = parseIdParam((await params).id)
  if (!id) return badRequest('Invalid product id')
  try {
    return NextResponse.json({ profile: await saveProfile(prisma, id, await readJson(request), auth.session.username) })
  } catch (error) {
    return errorResponse(error, 'save selling profile')
  }
}
