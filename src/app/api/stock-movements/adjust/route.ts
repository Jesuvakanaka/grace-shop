import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { adjustStock } from '@/lib/stock';

export async function POST(request: Request) {
  try {
    const session = await requireRole(request, ['OWNER']);
    const body = await request.json();
    const { productId, newQuantity, notes } = body;
    
    if (productId === undefined || newQuantity === undefined) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    
    const movement = await adjustStock(
      Number(productId),
      Number(newQuantity),
      notes || 'Manual stock adjustment',
      session.username
    );
    
    return NextResponse.json(movement);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
