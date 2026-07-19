import { NextResponse } from 'next/server';
import prisma from '@/lib/db';
import bcrypt from 'bcryptjs';

export async function POST(request: Request) {
  try {
    const usersCount = await prisma.user.count();
    if (usersCount > 0) {
      return NextResponse.json({ error: 'Setup already complete' }, { status: 403 });
    }
    
    const body = await request.json();
    const { username, password, fullName } = body;
    
    if (!username || !password || !fullName) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash: hashedPassword,
        fullName,
        role: 'OWNER'
      }
    });
    
    return NextResponse.json({ success: true, user: { id: user.id, username: user.username, role: user.role } });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
