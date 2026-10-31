import { NextResponse } from 'next/server';
import { recordDebtorPayment } from '@/lib/debtors';
import { getSession } from '@/lib/auth';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession(request);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const body = await request.json();
    const { amount, notes } = body;
    
    if (typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json({ error: 'amount must be > 0' }, { status: 400 });
    }

    const payment = await recordDebtorPayment(Number(id), amount, notes, session.username);
    return NextResponse.json(payment, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
