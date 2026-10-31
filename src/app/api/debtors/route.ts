import { NextResponse } from 'next/server';
import { getAllDebtors, findOrCreateDebtor } from '@/lib/debtors';
import { authorize } from '@/lib/api-auth';

export async function GET(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  try {
    const debtors = await getAllDebtors();
    return NextResponse.json(debtors);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json();
    const { customerName, phoneNumber } = body;
    if (!customerName) return NextResponse.json({ error: 'customerName is required' }, { status: 400 });

    const debtor = await findOrCreateDebtor(customerName, phoneNumber);
    return NextResponse.json(debtor, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
