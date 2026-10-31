import { NextResponse } from 'next/server';
import { authorize, OWNER_ONLY } from '@/lib/api-auth';
import { adjustStock } from '@/lib/stock';

export async function POST(request: Request) {
  const auth = await authorize(request, OWNER_ONLY);
  if (!auth.ok) return auth.response;
  const { session } = auth;
  try {
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
