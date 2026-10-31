import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { hashPassword, createToken } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    const userCount = await prisma.user.count();
    if (userCount > 0) {
      return NextResponse.json({ error: 'Setup already completed. Users exist.' }, { status: 403 });
    }

    const { username, password, fullName } = await request.json();

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
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
