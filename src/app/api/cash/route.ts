import { NextResponse } from 'next/server';
import prisma from '@/lib/db';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const dateStr = searchParams.get('date') || new Date().toISOString().split('T')[0];
    const date = new Date(dateStr);
    
    let cashPos = await prisma.cashPosition.findFirst({
      where: { date: { gte: date, lt: new Date(date.getTime() + 86400000) } }
    });
    
    if (!cashPos) {
      cashPos = await prisma.cashPosition.create({ data: { date } });
    }
    
    return NextResponse.json(cashPos);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { id, openingCash, actualCountedCash, otherCashIn, notes } = body;
    
    if (!id) return NextResponse.json({ error: 'Missing ID' }, { status: 400 });
    
    const updated = await prisma.cashPosition.update({
      where: { id },
      data: { openingCash, actualCountedCash, otherCashIn, notes }
    });
    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
