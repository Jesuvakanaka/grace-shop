import { NextResponse } from 'next/server';
import { getCreditorById } from '@/lib/creditors';
import { authorize } from '@/lib/api-auth';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    const creditor = await getCreditorById(Number(id));
    if (!creditor) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(creditor);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
