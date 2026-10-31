import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { getActiveExchangeRate, getAllExchangeRates, createExchangeRate } from '@/lib/exchange-rate';

export async function GET(request: Request) {
  try {
    const rates = await getAllExchangeRates();
    const mappedRates = rates.map(r => ({
      id: r.id,
      rate: r.rmbToUsd > 0 ? 1 / r.rmbToUsd : 0,
      createdAt: r.createdAt,
      createdBy: r.createdBy
    }));
    
    return NextResponse.json({
      activeRate: mappedRates[0] || null,
      history: mappedRates
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireRole(request, ['OWNER']);
    const body = await request.json();
    const { rate, effectiveDate, notes } = body;
    
    if (rate === undefined || Number(rate) <= 0) {
      return NextResponse.json({ error: 'RMB to USD rate must be a positive number' }, { status: 400 });
    }
    
    // Convert USD-to-RMB rate (e.g. 7.3) to RMB-to-USD multiplier (e.g. 1/7.3 = 0.137)
    const rmbToUsd = 1 / Number(rate);
    
    const dbRate = await createExchangeRate({
      rmbToUsd,
      effectiveDate: effectiveDate ? new Date(effectiveDate) : new Date(),
      notes,
      createdBy: session.username
    });
    
    return NextResponse.json({
      id: dbRate.id,
      rate: Number(rate),
      createdAt: dbRate.createdAt,
      createdBy: dbRate.createdBy
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
