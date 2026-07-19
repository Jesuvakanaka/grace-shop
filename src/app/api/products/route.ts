import { NextResponse } from 'next/server';
import { getAllProducts, createProduct } from '@/lib/products';
import { requireRole } from '@/lib/auth';

export async function GET() {
  try {
    const products = await getAllProducts();
    return NextResponse.json(products);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireRole(request, ['OWNER']);
    const body = await request.json();
    
    if (!body.name || body.costPriceDollar === undefined || body.markupPercentage === undefined) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    
    const product = await createProduct(body);
    return NextResponse.json(product);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: error.message?.includes('Unauthorized') ? 401 : 500 });
  }
}
