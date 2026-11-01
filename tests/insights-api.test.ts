// ZP-505: GET /api/insights (src/app/api/insights/route.ts) against DATABASE_URL.
// - OWNER only: 401 without a session, 403 for STAFF.
// - 400 for a bad range or report name.
// - JSON report; CSV per report with a download file name; never cached.
import { describe, test, after } from 'node:test'
import assert from 'node:assert'

process.env.JWT_SECRET = 'zp505-insights-api-tests-secret-0123456789abcdef'

import prisma from '../src/lib/db'
import { createToken } from '../src/lib/auth'
import { GET } from '../src/app/api/insights/route'
import { INSIGHTS_REPORTS } from '../src/lib/insights/csv'

async function req(query: string, role?: 'OWNER' | 'STAFF') {
  const headers: Record<string, string> = {}
  if (role) headers.cookie = `auth-token=${await createToken(1, role.toLowerCase(), role)}`
  return GET(new Request(`http://localhost/api/insights${query}`, { headers }))
}

after(async () => {
  await prisma.$disconnect()
})

describe('GET /api/insights', () => {
  test('401 without a session', async () => {
    const res = await req('?range=7d')
    assert.strictEqual(res.status, 401)
  })

  test('403 for staff', async () => {
    const res = await req('?range=7d', 'STAFF')
    assert.strictEqual(res.status, 403)
  })

  test('403 for staff also for CSV', async () => {
    const res = await req('?range=7d&csv=looks', 'STAFF')
    assert.strictEqual(res.status, 403)
  })

  test('owner gets the JSON report, not cached', async () => {
    const res = await req('?range=30d', 'OWNER')
    assert.strictEqual(res.status, 200)
    assert.match(res.headers.get('cache-control') ?? '', /no-store/)
    const body = await res.json()
    assert.strictEqual(body.range.preset, '30d')
    assert.strictEqual(body.range.days, 30)
    assert.ok(body.overview && body.looks && body.funnel && body.health)
  })

  test('400 for a bad range or report', async () => {
    assert.strictEqual((await req('?range=custom&from=2026-02-30&to=2026-03-01', 'OWNER')).status, 400)
    assert.strictEqual((await req('?range=week', 'OWNER')).status, 400)
    assert.strictEqual((await req('?range=7d&csv=visitors', 'OWNER')).status, 400)
  })

  test('owner downloads every report as CSV', async () => {
    for (const name of INSIGHTS_REPORTS) {
      const res = await req(`?range=7d&csv=${name}`, 'OWNER')
      assert.strictEqual(res.status, 200, name)
      assert.match(res.headers.get('content-type') ?? '', /^text\/csv; charset=utf-8/)
      assert.match(res.headers.get('content-disposition') ?? '', new RegExp(`^attachment; filename="vyra-insights-${name}-\\d{4}-\\d{2}-\\d{2}-to-\\d{4}-\\d{2}-\\d{2}\\.csv"$`))
      assert.match(res.headers.get('cache-control') ?? '', /no-store/)
      // text() would drop the BOM while decoding: check the bytes.
      const bytes = new Uint8Array(await res.arrayBuffer())
      assert.deepStrictEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], name)
      assert.ok(new TextDecoder().decode(bytes).split('\r\n')[0].includes(','), name)
    }
  })
})
