import { NextResponse } from 'next/server';
import { getSaleById } from '@/lib/sales';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const sale = await getSaleById(Number(id));
    if (!sale) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(sale);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
