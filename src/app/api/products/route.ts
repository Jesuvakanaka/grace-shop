import { NextResponse } from 'next/server';
import { getAllProducts, createProduct } from '@/lib/products';
import { getSession, requireRole } from '@/lib/auth';

export async function GET() {
  try {
    const products = await getAllProducts();
    return NextResponse.json(products);
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
    const { itemNumber, productName, unitCostRmb, openingQuantity, ...rest } = body;

    if (!itemNumber || !productName || unitCostRmb === undefined || openingQuantity === undefined) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const newProduct = await createProduct({
      itemNumber,
      productName,
      unitCostRmb,
      openingQuantity,
      createdBy: session.username,
      ...rest,
    });

    return NextResponse.json(newProduct, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
