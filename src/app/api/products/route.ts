import { NextResponse } from 'next/server';
import { getAllProducts, createProduct } from '@/lib/products';
import { authorize, OWNER_ONLY } from '@/lib/api-auth';
import { parseWholesaleFields } from '@/lib/validation/product';

export async function GET(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  try {
    const products = await getAllProducts();
    return NextResponse.json(products);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await authorize(request, OWNER_ONLY);
  if (!auth.ok) return auth.response;
  const { session } = auth;
  try {
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
      ...rest,
      ...wholesale.data,
      // Last, so a client-supplied createdBy can never override the session user.
      createdBy: session.username,
    });

    return NextResponse.json(newProduct, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
