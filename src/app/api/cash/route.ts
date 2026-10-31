import { NextResponse } from 'next/server';
import { getOrCreateCashPosition, recalculateCashPosition, updateCashPosition } from '@/lib/cash';
import { authorize } from '@/lib/api-auth';

export async function GET(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  try {
    const url = new URL(request.url);
    const dateStr = url.searchParams.get('date');
    if (!dateStr) return NextResponse.json({ error: 'date is required' }, { status: 400 });
    const position = await getOrCreateCashPosition(new Date(dateStr));
    return NextResponse.json(position);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json();
    const { date, fields } = body;
    if (!date || !fields) {
      return NextResponse.json({ error: 'date and fields are required' }, { status: 400 });
    }
    const d = new Date(date);
    for (const [field, amount] of Object.entries(fields)) {
      if (typeof amount === 'number') {
        await updateCashPosition(d, field, amount);
      }
    }
    const updated = await recalculateCashPosition(d);
    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
