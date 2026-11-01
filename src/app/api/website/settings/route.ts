// ZP-486: VYRA site settings (contacts, hours, socials, about, home, SEO).
// OWNER only, for reading too. The storefront reads getPublicSiteSettings().
//   GET -> { settings }
//   PUT  (partial, allow-listed fields only) -> { settings } | 400 { error, fieldErrors }
import { NextResponse } from 'next/server'
import { authorize, OWNER_ONLY } from '@/lib/api-auth'
import prisma from '@/lib/db'
import { readSiteSettings, updateSiteSettings } from '@/lib/site-settings/db'
import { revalidateSiteSettings, settingsRevalidateScope } from '@/lib/site-settings/revalidate'
import { validateSiteSettingsInput } from '@/lib/site-settings/validate'
import { runRanking } from '@/lib/ranking/job'

export async function GET(request: Request) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response
  try {
    return NextResponse.json({ settings: await readSiteSettings(prisma) })
  } catch (error) {
    console.error('[site-settings] read failed:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Could not load the site settings' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth.response

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 })
  }

  const result = validateSiteSettingsInput(body)
  if (!result.ok) {
    const unknown = Object.entries(result.errors)
      .filter(([, msg]) => msg === 'Unknown field.')
      .map(([k]) => k)
    const error = unknown.length ? `Unknown field(s): ${unknown.join(', ')}` : result.errors._form ?? 'Please fix the highlighted fields'
    return NextResponse.json({ error, fieldErrors: result.errors }, { status: 400 })
  }

  try {
    const before = await readSiteSettings(prisma)
    const settings = await updateSiteSettings(prisma, result.value, auth.session.username)
    // ZP-506: back to "Rank automatically": rank now (scores, today's order,
    // the automatic Featured set) instead of waiting for the nightly job.
    if (before.feedRanking !== 'AUTO' && settings.feedRanking === 'AUTO') {
      try {
        await runRanking(prisma)
      } catch (error) {
        // The switch is saved; the nightly job ranks again.
        console.error('[site-settings] ranking after the switch failed:', error instanceof Error ? error.message : error)
      }
    }
    // A changed few-left threshold or feed order expires the whole storefront (product DTOs embed them).
    revalidateSiteSettings(settingsRevalidateScope(before, settings))
    return NextResponse.json({ settings })
  } catch (error) {
    console.error('[site-settings] save failed:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Could not save the site settings' }, { status: 500 })
  }
}
