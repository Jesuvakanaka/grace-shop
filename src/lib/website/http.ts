// Shared HTTP helpers for src/app/api/website/** (ZP-483). Server only.
import { NextResponse } from 'next/server'
import { CONFLICT_MESSAGE } from './labels'

/** An expected failure with a status, a message for the owner and optional extra fields. */
export class WebsiteError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message)
  }
}

export const badRequest = (error: string, field?: string) =>
  NextResponse.json(field ? { error, field } : { error }, { status: 400 })

export const notFound = (what = 'Product') => NextResponse.json({ error: `${what} not found` }, { status: 404 })

function prismaCode(error: unknown): string | null {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : null
  return typeof code === 'string' ? code : null
}

/**
 * Map an error to a response:
 * - WebsiteError: its status and message.
 * - P2002 (unique), P2034 (write conflict), P2003 (foreign key, e.g. a
 *   category gained a product mid-delete): 409 "Someone else just changed this".
 * - P2025 (row vanished) or "... not found" from the storefront-model helpers: 404.
 * - Anything else: a generic 500 (details only in the server log).
 */
export function errorResponse(error: unknown, context: string): NextResponse {
  if (error instanceof WebsiteError) {
    return NextResponse.json({ error: error.message, ...error.extra }, { status: error.status })
  }
  const code = prismaCode(error)
  if (code === 'P2002' || code === 'P2034' || code === 'P2003') {
    return NextResponse.json({ error: CONFLICT_MESSAGE }, { status: 409 })
  }
  if (code === 'P2025') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (error instanceof Error && /not found/i.test(error.message) && !code) {
    return NextResponse.json({ error: error.message }, { status: 404 })
  }
  console.error(`[website] ${context} failed:`, error instanceof Error ? error.message : error)
  return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
}

/** The parsed JSON body, or undefined when it is missing or malformed. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}
