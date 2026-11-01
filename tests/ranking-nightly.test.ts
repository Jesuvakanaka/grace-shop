// ZP-506 review: the nightly job's steps (rollup, ranking, review-photo
// cleanup) each run in their own try/catch; the cleanup always runs; the job
// exits 1 at the end if any step failed. No database.
import { describe, test } from 'node:test'
import assert from 'node:assert'
import { runNightlySteps } from '../src/lib/ranking/nightly'

function recorder() {
  const ran: string[] = []
  const logs: string[] = []
  const errors: string[] = []
  const step = (name: string, fail = false) => ({
    name,
    run: async () => {
      ran.push(name)
      if (fail) throw new Error(`${name} broke`)
      return { ok: true }
    },
  })
  return { ran, logs, errors, step, log: (s: string) => logs.push(s), logError: (s: string) => errors.push(s) }
}

describe('nightly job steps', () => {
  test('all steps succeed: every step runs in order, one JSON line each, exit 0', async () => {
    const r = recorder()
    const code = await runNightlySteps([r.step('analytics-rollup'), r.step('ranking'), r.step('reviews-cleanup')], r)
    assert.strictEqual(code, 0)
    assert.deepStrictEqual(r.ran, ['analytics-rollup', 'ranking', 'reviews-cleanup'])
    assert.deepStrictEqual(r.logs.map((l) => JSON.parse(l).job), ['analytics-rollup', 'ranking', 'reviews-cleanup'])
    assert.deepStrictEqual(r.errors, [])
  })

  test('ranking throws: the review cleanup still runs, the job exits 1', async () => {
    const r = recorder()
    const code = await runNightlySteps([r.step('analytics-rollup'), r.step('ranking', true), r.step('reviews-cleanup')], r)
    assert.strictEqual(code, 1)
    assert.deepStrictEqual(r.ran, ['analytics-rollup', 'ranking', 'reviews-cleanup'])
    assert.strictEqual(r.errors.length, 1)
    assert.match(r.errors[0], /ranking failed: ranking broke/)
  })

  test('the rollup throws: ranking (on the rollups already there) and the cleanup still run, exit 1', async () => {
    const r = recorder()
    const code = await runNightlySteps([r.step('analytics-rollup', true), r.step('ranking'), r.step('reviews-cleanup')], r)
    assert.strictEqual(code, 1)
    assert.deepStrictEqual(r.ran, ['analytics-rollup', 'ranking', 'reviews-cleanup'])
  })

  test('the cleanup throws: exit 1', async () => {
    const r = recorder()
    assert.strictEqual(await runNightlySteps([r.step('ranking'), r.step('reviews-cleanup', true)], r), 1)
  })
})
