import { NextResponse } from 'next/server';
import prisma from '@/lib/db';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { amount, notes } = body;
    
    if (!amount || amount <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }
    
    const tx = await prisma.creditorTransaction.create({
      data: {
        creditorId: id,
        type: 'PAYMENT',
        amount,
        notes
      }
    });
    
    await prisma.creditor.update({
      where: { id },
      data: { balance: { decrement: amount } }
    });
    
    return NextResponse.json(tx);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
