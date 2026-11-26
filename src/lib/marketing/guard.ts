// VYRA Marketing hub (ZP-1200): the auth + kill-switch check every marketing API starts with. Server only.
import { NextResponse } from 'next/server'
import { authorize, OWNER_ONLY, type AuthResult } from '@/lib/api-auth'
import { hubEnabled } from './flags'

/** OWNER only; 404 when GRACE_MARKETING_HUB is "false". */
export async function marketingAuth(request: Request): Promise<AuthResult> {
  const auth = await authorize(request, OWNER_ONLY)
  if (!auth.ok) return auth
  if (!hubEnabled()) return { ok: false, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  return auth
}
