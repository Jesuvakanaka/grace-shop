import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { closeDayClosing } from '@/lib/closing';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole(request, ['OWNER']);
    const { id } = await params;
    const body = await request.json();
    
    const { signOffName, actualCountedCash } = body;
    if (!signOffName || actualCountedCash === undefined) {
      return NextResponse.json({ error: 'Missing signOffName or actualCountedCash' }, { status: 400 });
    }

    const closing = await closeDayClosing(
      Number(id),
      signOffName,
      Number(actualCountedCash),
      session.username
    );
    
    return NextResponse.json(closing);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
