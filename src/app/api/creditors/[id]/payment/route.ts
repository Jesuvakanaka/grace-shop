import { NextResponse } from 'next/server';
import { recordCreditorPayment } from '@/lib/creditors';
import { authorize } from '@/lib/api-auth';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  const { session } = auth;
  try {
    const { id } = await params;
    const body = await request.json();
    const { amount, notes } = body;
    
    if (amount === undefined || amount <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }
    
    const transaction = await recordCreditorPayment(
      Number(id),
      Number(amount),
      notes || undefined,
      session.username
    );
    
    return NextResponse.json(transaction);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
