import * as bcrypt from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'

export type Role = 'OWNER' | 'STAFF'
export const ROLES: readonly Role[] = ['OWNER', 'STAFF']

export interface Session {
  userId: number
  username: string
  role: Role
}

export const MIN_JWT_SECRET_LENGTH = 32

// Only ever used when NODE_ENV is 'development' or 'test'. Never valid in production.
const INSECURE_DEV_ONLY_JWT_SECRET = 'grace-shop-insecure-dev-only-jwt-secret-not-for-production'

type Env = Partial<Record<'JWT_SECRET' | 'NODE_ENV', string | undefined>>

/**
 * Resolve the JWT signing key at call time (not at module load, so `next build`
 * works without secrets). Fails closed: outside development/test a JWT_SECRET of
 * at least MIN_JWT_SECRET_LENGTH characters is required.
 */
export function getJwtSecret(env: Env = process.env): Uint8Array {
  const secret = env.JWT_SECRET
  const isDevOrTest = env.NODE_ENV === 'development' || env.NODE_ENV === 'test'

  if (secret && secret.length >= MIN_JWT_SECRET_LENGTH) {
    return new TextEncoder().encode(secret)
  }
  if (isDevOrTest) {
    return new TextEncoder().encode(secret || INSECURE_DEV_ONLY_JWT_SECRET)
  }
  throw new Error(
    `JWT_SECRET must be set to at least ${MIN_JWT_SECRET_LENGTH} characters outside development/test`
  )
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export async function createToken(userId: number, username: string, role: string): Promise<string> {
  return await new SignJWT({ userId, username, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(getJwtSecret())
}

export async function verifyToken(token: string): Promise<{ userId: number; username: string; role: string } | null> {
  // Resolve the key outside the try: a missing secret is a server misconfiguration
  // and must surface as an error, not be swallowed as "signed out".
  const key = getJwtSecret()
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] })
    if (typeof payload.userId !== 'number' || typeof payload.username !== 'string' || typeof payload.role !== 'string') {
      return null
    }
    return { userId: payload.userId, username: payload.username, role: payload.role }
  } catch {
    return null
  }
}

export async function getSession(request: Request) {
  const cookie = request.headers.get('cookie')
  if (!cookie) return null
  const tokenMatch = cookie.match(/(?:^|;) *auth-token=([^;]*)/)
  if (!tokenMatch || !tokenMatch[1]) return null
  return verifyToken(tokenMatch[1])
}
