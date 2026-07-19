import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import prisma from '@/lib/db';

export async function POST(request: Request) {
  try {
    await requireRole(request, ['OWNER']);
    const body = await request.json();
    const { productId, newQuantity, notes } = body;
    
    if (!productId || newQuantity === undefined) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    
    const diff = newQuantity - product.stockQuantity;
    
    const movement = await prisma.stockMovement.create({
      data: {
        productId,
        type: 'MANUAL_ADJUSTMENT',
        quantity: diff,
        notes
      }
    });
    
    await prisma.product.update({
      where: { id: productId },
      data: { stockQuantity: newQuantity }
    });
    
    return NextResponse.json(movement);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
