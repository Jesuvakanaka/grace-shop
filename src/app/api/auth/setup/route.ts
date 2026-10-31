import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { hashPassword, createToken, getJwtSecret } from '@/lib/auth';
import { isSetupAllowed } from '@/lib/setup-guard';

export async function POST(request: Request) {
  if (!isSetupAllowed()) {
    return NextResponse.json({ error: 'First-time setup is disabled on this server' }, { status: 403 });
  }

  let body: { username?: string; password?: string; fullName?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    // Fail before any side effect if sessions can't be issued (misconfigured JWT_SECRET).
    getJwtSecret();

    const userCount = await prisma.user.count();
    if (userCount > 0) {
      return NextResponse.json({ error: 'Setup already completed. Users exist.' }, { status: 403 });
    }

    const { username, password, fullName } = body;

    if (!username || !password || !fullName) {
      return NextResponse.json({ error: 'Username, password, and full name are required' }, { status: 400 });
    }

    const hashedPassword = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
        fullName,
        role: 'OWNER',
      },
    });

    const token = await createToken(user.id, user.username, user.role);

    const response = NextResponse.json({
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        role: user.role,
      },
    });

    response.cookies.set('auth-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24,
    });

    return response;
  } catch (error: unknown) {
    console.error('[auth/setup] failed:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
