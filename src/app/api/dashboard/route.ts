import { NextResponse } from 'next/server';
import { getDashboardData } from '@/lib/dashboard';
import { authorize } from '@/lib/api-auth';

export async function GET(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;
  try {
    const data = await getDashboardData();
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
