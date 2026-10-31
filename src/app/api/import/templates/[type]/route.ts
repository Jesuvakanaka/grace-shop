import { NextResponse } from 'next/server';
import { authorize, OWNER_ONLY } from '@/lib/api-auth';

export async function GET(request: Request, { params }: { params: Promise<{ type: string }> }) {
  const auth = await authorize(request, OWNER_ONLY);
  if (!auth.ok) return auth.response;
  try {
    const { type } = await params;
    return NextResponse.json({ success: true, message: `Template for ${type} not fully implemented in MVP` });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
