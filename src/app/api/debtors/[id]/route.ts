import { NextResponse } from 'next/server';
import prisma from '@/lib/db';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const debtor = await prisma.debtor.findUnique({
      where: { id },
      include: { transactions: { orderBy: { date: 'desc' } } }
    });
    if (!debtor) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(debtor);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
