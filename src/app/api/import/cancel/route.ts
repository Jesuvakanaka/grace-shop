import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import prisma from '@/lib/db';

export async function POST(request: Request) {
  try {
    await requireRole(request, ['OWNER']);
    const body = await request.json();
    const { importDocumentId } = body;
    
    if (!importDocumentId) {
      return NextResponse.json({ error: 'Import ID required' }, { status: 400 });
    }
    
    const doc = await prisma.importDocument.update({
      where: { id: importDocumentId },
      data: { status: 'CANCELLED' }
    });
    
    return NextResponse.json(doc);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
