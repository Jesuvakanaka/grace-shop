import { NextResponse } from 'next/server';

// Lightweight probe for Cloud Run startup/liveness checks.
// Deliberately no auth and no database access: it only proves the Node
// server is up and serving requests. Never cached or prerendered.
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    { status: 'ok' },
    { status: 200, headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
