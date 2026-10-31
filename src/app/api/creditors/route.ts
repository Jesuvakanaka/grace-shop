import { NextResponse } from 'next/server';
import { getAllCreditors, createCreditor } from '@/lib/creditors';
import { authorize, OWNER_ONLY } from '@/lib/api-auth';

export async function GET(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  try {
    const creditors = await getAllCreditors();
    return NextResponse.json(creditors);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await authorize(request, OWNER_ONLY);
  if (!auth.ok) return auth.response;
  const { session } = auth;
  try {
    const body = await request.json();
    const { creditorName, phoneNumber, description, totalAmountOwed, dueDate, notes } = body;
    
    if (!creditorName || typeof totalAmountOwed !== 'number') {
      return NextResponse.json({ error: 'creditorName and totalAmountOwed are required' }, { status: 400 });
    }

    const creditor = await createCreditor({
      creditorName,
      phoneNumber,
      description,
      totalAmountOwed,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      notes,
      createdBy: session.username
    });
    return NextResponse.json(creditor, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
