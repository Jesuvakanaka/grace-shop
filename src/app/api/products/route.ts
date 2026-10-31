import { NextResponse } from 'next/server';
import { getAllProducts, createProduct } from '@/lib/products';
import { getSession, requireRole } from '@/lib/auth';
import { parseWholesaleFields } from '@/lib/validation/product';

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

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    const { itemNumber, productName, unitCostRmb, openingQuantity, ...rest } = body;

    if (!itemNumber || !productName || unitCostRmb === undefined || openingQuantity === undefined) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    const wholesale = parseWholesaleFields(body);
    if (!wholesale.ok) return NextResponse.json({ error: wholesale.error }, { status: 400 });

    const newProduct = await createProduct({
      itemNumber,
      productName,
      unitCostRmb,
      openingQuantity,
      createdBy: session.username,
      ...rest,
      ...wholesale.data,
    });

    return NextResponse.json(newProduct, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
