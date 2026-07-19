import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const categories = ['Rent', 'Utilities', 'Salaries', 'Office Supplies', 'Marketing', 'Other'];
    return NextResponse.json(categories);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
