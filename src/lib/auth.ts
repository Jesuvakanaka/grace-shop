import * as bcrypt from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'

const secretKey = process.env.JWT_SECRET || 'secret-key'
const key = new TextEncoder().encode(secretKey)

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
    .sign(key)
}

export async function verifyToken(token: string): Promise<{userId: number, username: string, role: string} | null> {
  try {
    const { payload } = await jwtVerify(token, key)
    return payload as {userId: number, username: string, role: string}
  } catch (error) {
    return null
  }
}

export async function getSession(request: Request) {
  const cookie = request.headers.get('cookie')
  if (!cookie) return null
  const tokenMatch = cookie.match(/(?:^|;) *auth-token=([^;]*)/)
  if (!tokenMatch) return null
  const token = tokenMatch[1]
  return verifyToken(token)
}

export async function requireRole(request: Request, roles: string[]) {
  const session = await getSession(request)
  if (!session) throw new Error('Unauthorized')
  if (!roles.includes(session.role)) throw new Error('Forbidden')
  return session
}
