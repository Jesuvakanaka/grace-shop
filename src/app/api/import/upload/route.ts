import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { processImport } from '@/lib/import/importer';

export async function POST(request: Request) {
  try {
    await requireRole(request, ['OWNER']);
    const formData = await request.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await processImport(buffer, file.name);
    
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
