import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import type { Role } from '@/lib/auth';
import { isQuickLoginEnabled, parseQuickLoginRole, QUICK_LOGIN_ROLES } from '@/lib/quick-login';
import { isSetupAllowed } from '@/lib/setup-guard';
import { signedInResponse } from '@/lib/session-cookie';

// GRACE_QUICK_LOGIN / ALLOW_SETUP are read at request time (Cloud Run env), never at build.
export const dynamic = 'force-dynamic';

/** First ACTIVE user of a role, lowest id first. */
function firstActiveUser(role: Role) {
  return prisma.user.findFirst({
    where: { role, active: true },
    orderBy: { id: 'asc' },
    select: { id: true, username: true, fullName: true, role: true },
  });
}

/**
 * Public. Tells the login page whether to show the UAT quick sign-in buttons and
 * the first-time setup link. Never returns ids or password hashes.
 */
export async function GET() {
  const setupAllowed = isSetupAllowed();
  if (!isQuickLoginEnabled()) {
    return NextResponse.json({ enabled: false, setupAllowed });
  }

  try {
    const users = [];
    for (const role of QUICK_LOGIN_ROLES) {
      const user = await firstActiveUser(role);
      if (user) users.push({ role, username: user.username, fullName: user.fullName });
    }
    return NextResponse.json({ enabled: true, setupAllowed, users });
  } catch (error: unknown) {
    console.error('[auth/quick-login] list failed:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/** Public, UAT only. Signs in as the first active user of `role` without a password. */
export async function POST(request: Request) {
  // Flag off: behave as if the route doesn't exist. Before parsing the body or touching the DB.
  if (!isQuickLoginEnabled()) {
    return NextResponse.json({ error: 'Not Found' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const role = parseQuickLoginRole(body);
  if (!role) {
    return NextResponse.json({ error: `role must be one of ${QUICK_LOGIN_ROLES.join(', ')}` }, { status: 400 });
  }

  try {
    const user = await firstActiveUser(role);
    if (!user) {
      return NextResponse.json({ error: `No active ${role} user` }, { status: 404 });
    }

    const response = await signedInResponse(user);
    console.info('[quick-login]', role, user.username);
    return response;
  } catch (error: unknown) {
    console.error('[auth/quick-login] failed:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
