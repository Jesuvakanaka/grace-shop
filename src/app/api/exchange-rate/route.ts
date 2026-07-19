import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import prisma from '@/lib/db';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const active = searchParams.get('active') === 'true';
    
    if (active) {
      const rate = await prisma.exchangeRate.findFirst({
        where: { isActive: true },
        orderBy: { date: 'desc' }
      });
      return NextResponse.json(rate);
    }
    
    const rates = await prisma.exchangeRate.findMany({ orderBy: { date: 'desc' } });
    return NextResponse.json(rates);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireRole(request, ['OWNER']);
    const body = await request.json();
    if (!body.rate) return NextResponse.json({ error: 'Rate is required' }, { status: 400 });
    
    if (body.isActive) {
      await prisma.exchangeRate.updateMany({ data: { isActive: false } });
    }
    
    const rate = await prisma.exchangeRate.create({ data: body });
    return NextResponse.json(rate);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
