import { NextResponse } from 'next/server';

export async function GET(request: Request, { params }: { params: Promise<{ type: string }> }) {
  try {
    const { type } = await params;
    return NextResponse.json({ success: true, message: `Template for ${type} not fully implemented in MVP` });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
