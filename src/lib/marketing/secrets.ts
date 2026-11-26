// VYRA Marketing hub (ZP-1200): channel tokens at rest. AES-256-GCM, never logged. Server only.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

const INFO = 'grace-marketing-tokens-v1'

function key(): Buffer {
  const secret = process.env.MARKETING_TOKEN_KEY ?? process.env.JWT_SECRET
  if (!secret) throw new Error('Set MARKETING_TOKEN_KEY (or JWT_SECRET) before saving channel credentials.')
  return Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), INFO, 32))
}

/** `v1:<iv b64>:<tag b64>:<ciphertext b64>` */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${data.toString('base64')}`
}

/** Throws when the value is malformed, tampered with, or the key changed. */
export function decryptSecret(stored: string): string {
  const parts = stored.split(':')
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Unreadable saved credentials.')
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(parts[1], 'base64'))
    decipher.setAuthTag(Buffer.from(parts[2], 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64')), decipher.final()]).toString('utf8')
  } catch {
    throw new Error('Saved credentials could not be decrypted (changed or damaged).')
  }
}

export const encryptJson = (value: unknown) => encryptSecret(JSON.stringify(value))
export const decryptJson = <T = unknown>(stored: string): T => JSON.parse(decryptSecret(stored)) as T

/** The last 4 characters, for "connected, ends ...1234". */
export function tokenHint(token: string): string {
  return token.trim().slice(-4)
}
