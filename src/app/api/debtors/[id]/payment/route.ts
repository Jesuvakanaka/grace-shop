import { NextResponse } from 'next/server';
import { recordDebtorPayment } from '@/lib/debtors';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { amount, notes } = body;
    
    if (!amount || amount <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }
    
    const tx = await recordDebtorPayment(id, amount, notes);
    return NextResponse.json(tx);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
