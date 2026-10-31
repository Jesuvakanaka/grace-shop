import type { Role } from '@/lib/auth';

type Env = { GRACE_QUICK_LOGIN?: string; [key: string]: string | undefined };

/** Roles that get a quick sign-in button, in display order. */
export const QUICK_LOGIN_ROLES: readonly Role[] = ['OWNER', 'STAFF'];

/**
 * UAT quick sign-in (one button per role on the login page, no password).
 * Owner-accepted risk for UAT with test data only: anyone with the URL can sign
 * in as the owner. Off unless GRACE_QUICK_LOGIN is exactly the string "true".
 * It MUST be off before real data or go-live.
 */
export function isQuickLoginEnabled(env: Env = process.env): boolean {
  return env.GRACE_QUICK_LOGIN === 'true';
}

/** Returns the requested role from a parsed POST body, or null when it isn't one of QUICK_LOGIN_ROLES. */
export function parseQuickLoginRole(body: unknown): Role | null {
  if (typeof body !== 'object' || body === null) return null;
  const role = (body as { role?: unknown }).role;
  if (typeof role !== 'string') return null;
  return (QUICK_LOGIN_ROLES as readonly string[]).includes(role) ? (role as Role) : null;
}
