import { NextResponse } from 'next/server';
import { getProductById, updateProduct } from '@/lib/products';
import { authorize, OWNER_ONLY } from '@/lib/api-auth';
import { parseWholesaleFields } from '@/lib/validation/product';
import { checkImageUrl, ProductImageError, updateProductAndGallery } from '@/lib/website/product-image-sync';
import { revalidateStorefront } from '@/lib/website/revalidate';
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
    // ZP-483: a changed picture also updates the storefront gallery (same transaction).
    const image = checkImageUrl(body.imageUrl);
    if (!image.ok) return NextResponse.json({ error: image.error }, { status: 400 });
    const updated = image.value === undefined
      ? await updateProduct(Number(id), { ...body, ...wholesale.data })
      : await updateProductAndGallery(Number(id), { ...body, ...wholesale.data });
    // ZP-483: price, picture or name may be on the public site.
    revalidateStorefront({ productSlugs: [updated.slug] });
    return NextResponse.json(updated);
  } catch (error: any) {
    if (error instanceof ProductImageError) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(request, OWNER_ONLY);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params;
    const deleted = await prisma.product.delete({ where: { id: Number(id) } });
    revalidateStorefront({ productSlugs: [deleted.slug] });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
