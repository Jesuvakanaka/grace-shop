import { NextResponse } from 'next/server';
import { getProductById, updateProduct } from '@/lib/products';
import { authorize, OWNER_ONLY } from '@/lib/api-auth';
import { parseWholesaleFields } from '@/lib/validation/product';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    const product = await getProductById(Number(id));
    if (!product) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(product);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(request, OWNER_ONLY);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    const wholesale = parseWholesaleFields(body);
    if (!wholesale.ok) return NextResponse.json({ error: wholesale.error }, { status: 400 });
    const updated = await updateProduct(Number(id), { ...body, ...wholesale.data });
    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(request, OWNER_ONLY);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    await prisma.product.delete({ where: { id: Number(id) } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
