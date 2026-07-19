import { NextResponse } from 'next/server';
import prisma from '@/lib/db';

export async function GET() {
  try {
    const history = await prisma.importDocument.findMany({
      orderBy: { createdAt: 'desc' }
    });
    return NextResponse.json(history);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
