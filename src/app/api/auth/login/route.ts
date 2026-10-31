import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { verifyPassword } from '@/lib/auth';
import { signedInResponse } from '@/lib/session-cookie';

export async function POST(request: Request) {
  let body: { username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password are required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user || !user.active) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const valid = await verifyPassword(password, user.password);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    return await signedInResponse(user);
  } catch (error: unknown) {
    console.error('[auth/login] failed:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
