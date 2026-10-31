import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/auth';
import { authorize } from '@/lib/api-auth';
import { validatePasswordChange } from '@/lib/password-policy';

export async function POST(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  const { session } = auth;

  let body: { currentPassword?: unknown; newPassword?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user || !user.active) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const validation = validatePasswordChange({
      username: user.username,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
    });
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const currentOk = await verifyPassword(body.currentPassword as string, user.password);
    if (!currentOk) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { password: await hashPassword(body.newPassword as string) },
    });

    return NextResponse.json({ message: 'Password changed' });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
