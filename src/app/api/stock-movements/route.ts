import { NextResponse } from 'next/server';
import { getStockMovements } from '@/lib/stock';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const productIdStr = searchParams.get('productId');
    const startDateStr = searchParams.get('startDate');
    const endDateStr = searchParams.get('endDate');
    
    if (!productIdStr) {
      return NextResponse.json({ error: 'productId is required' }, { status: 400 });
    }
    
    const productId = Number(productIdStr);
    const startDate = startDateStr ? new Date(startDateStr) : undefined;
    const endDate = endDateStr ? new Date(endDateStr) : undefined;
    
    const movements = await getStockMovements(productId, startDate, endDate);
    return NextResponse.json(movements);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
