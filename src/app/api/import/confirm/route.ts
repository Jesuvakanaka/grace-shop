import { NextResponse } from 'next/server';
import { authorize, OWNER_ONLY } from '@/lib/api-auth';
import { confirmImport } from '@/lib/import/importer';

export async function POST(request: Request) {
  const auth = await authorize(request, OWNER_ONLY);
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json();
    const { importDocumentId, exchangeRate } = body;
    
    if (!importDocumentId) {
      return NextResponse.json({ error: 'Import ID required' }, { status: 400 });
    }
    
    const doc = await confirmImport(
      Number(importDocumentId),
      exchangeRate ? Number(exchangeRate) : undefined
    );
    
    return NextResponse.json(doc);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
