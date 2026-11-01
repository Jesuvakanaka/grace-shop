// ZP-508: POST /api/website/reviews/invites (OWNER only).
// Body: { productId: number | null, customerName?: string }
//   productId null = a shop-only review link.
// 201 { url, whatsappHref, message, expiresAt, productName }. The token is in
// the URL only: it is shown once and only its hash is stored. "Send on
// WhatsApp" is wa.me with the ready message and NO number (the owner picks
// the chat), so the site never stores a phone number.
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { authorize, OWNER_ONLY } from '@/lib/api-auth'
import { hostRoutingConfigFromEnv } from '@/lib/host-routing'
import { createReviewInvite } from '@/lib/reviews/invites'
import { reviewAbsoluteUrl, reviewInviteMessage, reviewWhatsAppHref } from '@/lib/reviews/links'
import { firstNameOf, validateCustomerHint } from '@/lib/reviews/rules'
import { badRequest, errorResponse, notFound, readJson } from '@/lib/website/http'

const FIELDS = new Set(['productId', 'customerName'])

export async function POST(request: Request) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response

  const body = await readJson(request)
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return badRequest('Expected a JSON object.')
  const input = body as Record<string, unknown>
  const unknown = Object.keys(input).find((k) => !FIELDS.has(k))
  if (unknown) return badRequest(`Unexpected field "${unknown}".`, unknown)
  const productId = input.productId ?? null
  if (productId !== null && !(typeof productId === 'number' && Number.isInteger(productId) && productId > 0)) {
    return badRequest('productId must be a product id or null (shop review).', 'productId')
  }
  const hint = validateCustomerHint(input.customerName)
  if (!hint.ok) return badRequest(hint.error, 'customerName')
  const firstName = hint.value ? firstNameOf(hint.value) : null

  try {
    const invite = await createReviewInvite(prisma, {
      productId: productId as number | null,
      customerHint: firstName,
      createdBy: auth.session.username,
    })
    const url = reviewAbsoluteUrl({
      token: invite.token,
      storefrontHosts: hostRoutingConfigFromEnv().storefrontHosts,
      host: request.headers.get('host'),
    })
    if (!url) return NextResponse.json({ error: 'Could not build the link for this address.' }, { status: 500 })
    const message = reviewInviteMessage({ firstName, pieceName: invite.productName, url })
    return NextResponse.json(
      { url, message, whatsappHref: reviewWhatsAppHref(message), expiresAt: invite.expiresAt.toISOString(), productName: invite.productName },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    if (error instanceof Error && error.message === 'Product not found') return notFound()
    return errorResponse(error, 'create review link')
  }
}
