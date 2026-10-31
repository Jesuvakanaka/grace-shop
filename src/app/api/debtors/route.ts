import { NextResponse } from 'next/server';
import { getAllDebtors, findOrCreateDebtor } from '@/lib/debtors';
import { getSession } from '@/lib/auth';

export async function GET() {
  try {
    const debtors = await getAllDebtors();
    return NextResponse.json(debtors);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession(request);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { customerName, phoneNumber } = body;
    if (!customerName) return NextResponse.json({ error: 'customerName is required' }, { status: 400 });

    const debtor = await findOrCreateDebtor(customerName, phoneNumber);
    return NextResponse.json(debtor, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
