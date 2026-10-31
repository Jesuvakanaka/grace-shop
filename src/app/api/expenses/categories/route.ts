import { NextResponse } from 'next/server';
import { getExpenseCategories } from '@/lib/expenses';

export async function GET() {
  try {
    const categories = await getExpenseCategories();
    return NextResponse.json(categories);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
