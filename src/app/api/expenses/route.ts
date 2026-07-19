import { NextResponse } from 'next/server';
import prisma from '@/lib/db';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');
    const where = date ? { date: { gte: new Date(date), lt: new Date(new Date(date).getTime() + 86400000) } } : {};
    
    const expenses = await prisma.expense.findMany({ where, orderBy: { date: 'desc' } });
    return NextResponse.json(expenses);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!body.description || !body.amount || body.amount <= 0) {
      return NextResponse.json({ error: 'Invalid expense data' }, { status: 400 });
    }
    const expense = await prisma.expense.create({ data: body });
    return NextResponse.json(expense);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
