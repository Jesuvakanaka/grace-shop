import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import prisma from '@/lib/db';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireRole(request, ['OWNER']);
    const { id } = await params;
    
    const closing = await prisma.dayClosing.update({
      where: { id },
      data: { status: 'FINALIZED', finalizedAt: new Date() }
    });
    
    return NextResponse.json(closing);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
