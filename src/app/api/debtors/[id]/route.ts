import { NextResponse } from 'next/server';
import { getDebtorById } from '@/lib/debtors';
import { authorize } from '@/lib/api-auth';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    const debtor = await getDebtorById(Number(id));
    if (!debtor) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(debtor);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
