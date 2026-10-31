import { NextResponse } from 'next/server';
import { getSession, ROLES, type Role, type Session } from '@/lib/auth';

export const OWNER_ONLY: readonly Role[] = ['OWNER'];
export const ANY_ROLE: readonly Role[] = ROLES;

export type AuthResult =
  | { ok: true; session: Session }
  | { ok: false; response: NextResponse };

/**
 * Shared auth check for API route handlers.
 *   - no / invalid / expired token          -> 401 { error: 'Unauthorized' }
 *   - valid token, role not in `roles`      -> 403 { error: 'Forbidden' }
 *   - JWT secret misconfigured (fail closed) -> 500 { error: 'Server misconfigured' }
 *
 * Usage:
 *   const auth = await authorize(request, OWNER_ONLY);
 *   if (!auth.ok) return auth.response;
 *   const { session } = auth;
 */
export async function authorize(request: Request, roles: readonly Role[] = ANY_ROLE): Promise<AuthResult> {
  let raw;
  try {
    raw = await getSession(request);
  } catch (error) {
    console.error('[auth] session verification unavailable:', error instanceof Error ? error.message : error);
    return { ok: false, response: NextResponse.json({ error: 'Server misconfigured' }, { status: 500 }) };
  }

  if (!raw) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  if (!(roles as readonly string[]).includes(raw.role)) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { ok: true, session: raw as Session };
}
