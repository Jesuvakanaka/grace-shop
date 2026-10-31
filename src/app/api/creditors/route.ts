import { NextResponse } from 'next/server';
import { getAllCreditors, createCreditor } from '@/lib/creditors';
import { getSession, requireRole } from '@/lib/auth';

export async function GET() {
  try {
    const creditors = await getAllCreditors();
    return NextResponse.json(creditors);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession(request);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    try {
      await requireRole(request, ['OWNER']);
    } catch {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

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
