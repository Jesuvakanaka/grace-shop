import { NextResponse } from 'next/server';
import { authorize, OWNER_ONLY } from '@/lib/api-auth';
import { processImport } from '@/lib/import/importer';

export async function POST(request: Request) {
  const auth = await authorize(request, OWNER_ONLY);
  if (!auth.ok) return auth.response;
  const { session } = auth;
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await processImport(buffer, file.name, session.username);
    
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
