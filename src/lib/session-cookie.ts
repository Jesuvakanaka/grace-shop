import { NextResponse } from 'next/server';
import { createToken } from '@/lib/auth';

export const AUTH_COOKIE_NAME = 'auth-token';
export const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24; // 24 hours, same as the JWT expiry

interface SignedInUser {
  id: number;
  username: string;
  fullName: string;
  role: string;
}

/**
 * The sign-in response shared by POST /api/auth/login and POST /api/auth/quick-login:
 * body `{ user: { id, username, fullName, role } }` plus the HttpOnly session cookie.
 * Throws if the JWT secret is misconfigured; callers turn that into a generic 500.
 */
export async function signedInResponse(user: SignedInUser): Promise<NextResponse> {
  const token = await createToken(user.id, user.username, user.role);

  const response = NextResponse.json({
    user: {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
    },
  });

  response.cookies.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: AUTH_COOKIE_MAX_AGE_SECONDS,
  });

  return response;
}
