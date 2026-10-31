import { NextResponse } from 'next/server';
import { authorize } from '@/lib/api-auth';
import { getDayClosing, getDayClosingSummary, createOrUpdateDayClosing } from '@/lib/closing';

export async function GET(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  try {
    const { searchParams } = new URL(request.url);
    const dateStr = searchParams.get('date');
    const date = dateStr ? new Date(dateStr) : new Date();
    
    // Attempt to get existing closing record
    let closing = await getDayClosing(date);
    
    // If not closed/created yet, generate summary data for presentation
    if (!closing) {
      const summary = await getDayClosingSummary(date);
      return NextResponse.json({ ...summary, status: 'DRAFT' });
    }
    
    return NextResponse.json(closing);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  const { session } = auth;
  try {
    const body = await request.json();
    
    const { dateStr, actualCountedCash, stockNotes, signOffName, closingNotes } = body;
    const date = dateStr ? new Date(dateStr) : new Date();
    
    const closing = await createOrUpdateDayClosing(date, {
      actualCountedCash: actualCountedCash !== undefined ? Number(actualCountedCash) : undefined,
      stockNotes,
      signOffName,
      closingNotes,
      createdBy: session.username
    });
    
    return NextResponse.json(closing);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
