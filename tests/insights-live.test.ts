// ZP-505 (review M1): the live view of days not rolled up yet is READ-ONLY,
// reuses the rollup's own SELECTs, has a short statement timeout and is
// cached per day with single-flight. No database: a fake client records
// what would be sent. (Numbers vs the nightly rollup: tests/insights-report-db.test.ts.)
import { describe, test, beforeEach } from 'node:test'
import assert from 'node:assert'
import { LIVE_CACHE_MS, LIVE_DAY_SQL, LIVE_STATEMENT_TIMEOUT, liveDay, resetLiveCache } from '../src/lib/insights/live'
import { ROLLUP_SELECTS, VISIT_ROWS_SELECT } from '../src/lib/analytics/rollup'

type Sent = { kind: 'exec' | 'query'; sql: string; params: unknown[] }

function fakeDb(opts: { fail?: boolean; delayMs?: number } = {}) {
  const transactions: Sent[][] = []
  const empty = { visits: { visits: 1 }, journey: [], depth: [], hour: [], piece: [], photo: [], video: [], health: [], option: [] }
  const db = {
    $executeRawUnsafe: (sql: string, ...params: unknown[]) => ({ kind: 'exec', sql, params }) as unknown as Promise<number>,
    $queryRawUnsafe: (sql: string, ...params: unknown[]) => ({ kind: 'query', sql, params }) as unknown as Promise<unknown>,
    $transaction: async (items: unknown) => {
      transactions.push(items as Sent[])
      await new Promise((r) => setTimeout(r, opts.delayMs ?? 5))
      if (opts.fail) throw new Error('canceling statement due to statement timeout')
      return [0, 0, [{ data: empty }]]
    },
  }
  return { db: db as never, transactions }
}

beforeEach(() => resetLiveCache())

describe('live day SQL', () => {
  test('is a single read: no writes, no temp tables, no locking clauses', () => {
    assert.doesNotMatch(LIVE_DAY_SQL, /\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|CREATE|DROP|ALTER|LOCK)\b/i)
    assert.doesNotMatch(LIVE_DAY_SQL, /\bFOR\s+(UPDATE|SHARE|NO KEY UPDATE|KEY SHARE)\b/i)
    assert.match(LIVE_DAY_SQL.trim(), /^WITH analytics_rollup_visit AS MATERIALIZED/)
  })

  test("reuses the nightly rollup's SELECTs verbatim (same numbers by construction)", () => {
    assert.ok(LIVE_DAY_SQL.includes(VISIT_ROWS_SELECT))
    for (const [name, s] of Object.entries(ROLLUP_SELECTS)) {
      if (name === 'source') continue // the Insights page reads sources from the journey rows
      assert.ok(LIVE_DAY_SQL.includes(s.select), name)
    }
  })
})

describe('liveDay', () => {
  test('runs in a READ ONLY transaction with a short statement timeout, one statement for the day', async () => {
    const { db, transactions } = fakeDb()
    const day = await liveDay(db, '2026-11-01', 0)
    assert.strictEqual(day.day, '2026-11-01')
    assert.strictEqual(transactions.length, 1)
    const [readOnly, timeout, query] = transactions[0]
    assert.strictEqual(readOnly.sql, 'SET TRANSACTION READ ONLY')
    assert.strictEqual(timeout.sql, `SET LOCAL statement_timeout = '${LIVE_STATEMENT_TIMEOUT}'`)
    assert.ok(parseInt(LIVE_STATEMENT_TIMEOUT, 10) <= 10, 'short')
    assert.strictEqual(query.sql, LIVE_DAY_SQL)
    assert.deepStrictEqual(query.params, ['2026-11-01'])
  })

  test('single-flight: concurrent requests for the same day share one query', async () => {
    const { db, transactions } = fakeDb({ delayMs: 20 })
    const a = liveDay(db, '2026-11-01', 0)
    const b = liveDay(db, '2026-11-01', 1)
    assert.strictEqual(a, b)
    await Promise.all([a, b])
    assert.strictEqual(transactions.length, 1)
  })

  test('cached per day for 60 s, then queried again; other days are separate', async () => {
    const { db, transactions } = fakeDb()
    await liveDay(db, '2026-11-01', 0)
    await liveDay(db, '2026-11-01', LIVE_CACHE_MS - 1)
    assert.strictEqual(transactions.length, 1)
    await liveDay(db, '2026-10-31', 10)
    assert.strictEqual(transactions.length, 2)
    await liveDay(db, '2026-11-01', LIVE_CACHE_MS + 1)
    assert.strictEqual(transactions.length, 3)
  })

  test('a failed query (timeout) is not cached', async () => {
    const failing = fakeDb({ fail: true })
    await assert.rejects(liveDay(failing.db, '2026-11-01', 0), /statement timeout/)
    const ok = fakeDb()
    await liveDay(ok.db, '2026-11-01', 1)
    assert.strictEqual(ok.transactions.length, 1)
  })
})
