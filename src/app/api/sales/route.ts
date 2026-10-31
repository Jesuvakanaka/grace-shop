import { NextResponse } from 'next/server';
import { createSale, getSales } from '@/lib/sales';
import { authorize } from '@/lib/api-auth';

export async function GET(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  try {
    const url = new URL(request.url);
    const dateStr = url.searchParams.get('date');
    const date = dateStr ? new Date(dateStr) : undefined;
    const sales = await getSales(date);
    return NextResponse.json(sales);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  const { session } = auth;
  try {
    const body = await request.json();
    const { saleDate, paymentType, items, customerName, customerPhone, cashAmount, creditAmount, notes } = body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Items array is required' }, { status: 400 });
    }
    if (!paymentType) {
      return NextResponse.json({ error: 'Payment type is required' }, { status: 400 });
    }

    // Allow-listed fields only; createdBy always comes from the session.
    const newSale = await createSale({
      saleDate: saleDate ? new Date(saleDate) : new Date(),
      paymentType,
      items,
      customerName,
      customerPhone,
      cashAmount,
      creditAmount,
      notes,
      createdBy: session.username,
    });
    return NextResponse.json(newSale, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
