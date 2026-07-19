import { NextResponse } from 'next/server';
import { createSale } from '@/lib/sales';
import prisma from '@/lib/db';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');
    const where = date ? { date: { gte: new Date(date), lt: new Date(new Date(date).getTime() + 86400000) } } : {};
    
    const sales = await prisma.sale.findMany({
      where,
      include: { items: true },
      orderBy: { date: 'desc' }
    });
    return NextResponse.json(sales);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({ error: 'Items are required' }, { status: 400 });
    }
    
    for (const item of body.items) {
      if (!item.productId || !item.quantity || !item.unitPrice) {
        return NextResponse.json({ error: 'Invalid item format' }, { status: 400 });
      }
    }
    
    if (body.paymentType === 'CREDIT' && !body.customerName) {
      return NextResponse.json({ error: 'Customer name required for credit sales' }, { status: 400 });
    }
    
    const sale = await createSale(body);
    return NextResponse.json(sale);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
