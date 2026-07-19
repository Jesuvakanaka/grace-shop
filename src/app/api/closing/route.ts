import { NextResponse } from 'next/server';
import prisma from '@/lib/db';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const dateStr = searchParams.get('date');
    if (!dateStr) return NextResponse.json({ error: 'Date is required' }, { status: 400 });
    
    const closing = await prisma.dayClosing.findFirst({
      where: { date: { gte: new Date(dateStr), lt: new Date(new Date(dateStr).getTime() + 86400000) } }
    });
    
    return NextResponse.json(closing || { status: 'NO_CLOSING_FOUND' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const closing = await prisma.dayClosing.upsert({
      where: { id: body.id || '' },
      update: body,
      create: body
    });
    return NextResponse.json(closing);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
