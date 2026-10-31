import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import { authorize, OWNER_ONLY } from '@/lib/api-auth';

export async function GET(request: Request) {
  const auth = await authorize(request, OWNER_ONLY);
  if (!auth.ok) return auth.response;
  try {
    const history = await prisma.importDocument.findMany({
      orderBy: { createdAt: 'desc' }
    });
    return NextResponse.json(history);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
