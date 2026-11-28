import { NextResponse } from 'next/server';
import { saleWithMoney } from '@/lib/sale-refunds';
import prisma from '@/lib/db';
import { authorize } from '@/lib/api-auth';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    // ZP-1118: with its refunds and money (collected, refunded, still owed).
    const n = Number(id);
    const sale = Number.isInteger(n) && n > 0 ? await saleWithMoney(prisma, n) : null;
    if (!sale) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(sale);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
