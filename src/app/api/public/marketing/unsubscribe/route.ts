// ZP-1200: the unsubscribe link in every email and text. PUBLIC (no sign-in): the signed token IS the permission.
// GET ?t=<token> shows a plain page (or JSON with Accept: application/json or ?format=json); POST does the same for
// one-click unsubscribe from mail apps. It only ever writes OPTED_OUT, and works even when the hub is switched off.
import prisma from '@/lib/db'
import { applyUnsubscribe } from '@/lib/marketing/unsubscribe'

export const dynamic = 'force-dynamic'

const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }

const page = (title: string, body: string, status: number) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head><body style="font-family:Arial,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.5"><h1>${title}</h1><p>${body}</p></body></html>`,
    { status, headers: { ...HEADERS, 'Content-Type': 'text/html; charset=utf-8' } },
  )

async function handle(request: Request, token: string | null, asJson: boolean): Promise<Response> {
  let result: 'done' | 'already' | 'invalid'
  try {
    result = await applyUnsubscribe(prisma, token)
  } catch (error) {
    console.error('Unsubscribe failed', error instanceof Error ? error.message : error)
    return asJson
      ? Response.json({ ok: false, error: 'Something went wrong. Please try again.' }, { status: 500, headers: HEADERS })
      : page('Something went wrong', 'Please try the link again in a few minutes.', 500)
  }
  if (result === 'invalid') {
    return asJson
      ? Response.json({ ok: false, error: 'This link is not valid.' }, { status: 400, headers: HEADERS })
      : page('This link is not valid', 'The link may be incomplete. Reply STOP to any message from us, or contact the shop, and we will remove you.', 400)
  }
  return asJson
    ? Response.json({ ok: true, status: result === 'done' ? 'unsubscribed' : 'already_unsubscribed' }, { headers: HEADERS })
    : page('You are unsubscribed', 'You will not get these messages from VYRA any more. If this was a mistake, just tell the shop and we will add you back.', 200)
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const asJson = url.searchParams.get('format') === 'json' || (request.headers.get('accept') ?? '').includes('application/json')
  return handle(request, url.searchParams.get('t'), asJson)
}

export async function POST(request: Request) {
  const url = new URL(request.url)
  let token = url.searchParams.get('t')
  if (!token) {
    try {
      const form = await request.formData()
      const t = form.get('t')
      token = typeof t === 'string' ? t : null
    } catch {
      token = null
    }
  }
  const wantsPage = (request.headers.get('accept') ?? '').includes('text/html') && url.searchParams.get('format') !== 'json'
  return handle(request, token, !wantsPage)
}
