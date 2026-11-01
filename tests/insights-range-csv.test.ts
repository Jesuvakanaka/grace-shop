// ZP-505: Insights date ranges (Harare analytics days) and CSV export. Pure, no database.
import { describe, test } from 'node:test'
import assert from 'node:assert'
import { parseInsightsRange, MAX_RANGE_DAYS } from '../src/lib/insights/range'
import { csvCell, toCsv, reportCsv, INSIGHTS_REPORTS } from '../src/lib/insights/csv'
import { emptyInsights } from '../src/lib/insights/types'

// 23:30 UTC on 1 Nov is 01:30 on 2 Nov in Harare.
const NOW = new Date('2026-11-01T23:30:00Z')

describe('parseInsightsRange', () => {
  const p = (q: string) => parseInsightsRange(new URLSearchParams(q), NOW)

  test('presets are Harare days and include today', () => {
    assert.deepStrictEqual(p('range=today'), { ok: true, range: { preset: 'today', from: '2026-11-02', to: '2026-11-02', days: 1 } })
    assert.deepStrictEqual(p('range=7d'), { ok: true, range: { preset: '7d', from: '2026-10-27', to: '2026-11-02', days: 7 } })
    assert.deepStrictEqual(p('range=30d'), { ok: true, range: { preset: '30d', from: '2026-10-04', to: '2026-11-02', days: 30 } })
  })

  test('default is 7 days', () => {
    assert.deepStrictEqual(p(''), p('range=7d'))
  })

  test('custom range', () => {
    assert.deepStrictEqual(p('range=custom&from=2026-10-01&to=2026-10-31'), {
      ok: true,
      range: { preset: 'custom', from: '2026-10-01', to: '2026-10-31', days: 31 },
    })
  })

  test('refuses bad input', () => {
    for (const q of [
      'range=yesterday',
      'range=custom',
      'range=custom&from=2026-10-01',
      'range=custom&from=2026-13-01&to=2026-10-02',
      'range=custom&from=2026-10-05&to=2026-10-01',
      'range=custom&from=2026-10-01&to=2026-11-03', // after today
      'range=custom&from=2024-01-01&to=2024-01-31', // older than the rollups keep
      `range=custom&from=2024-10-01&to=2026-11-01`, // too long
    ]) {
      const r = p(q)
      assert.strictEqual(r.ok, false, q)
      if (!r.ok) assert.ok(r.error.length > 0)
    }
    assert.ok(MAX_RANGE_DAYS >= 366)
  })
})

describe('CSV', () => {
  test('cells: quotes, commas, new lines, numbers, empty', () => {
    assert.strictEqual(csvCell('plain'), 'plain')
    assert.strictEqual(csvCell('a, b'), '"a, b"')
    assert.strictEqual(csvCell('say "hi"'), '"say ""hi"""')
    assert.strictEqual(csvCell('two\nlines'), '"two\nlines"')
    assert.strictEqual(csvCell(12.5), '12.5')
    assert.strictEqual(csvCell(-3), '-3')
    assert.strictEqual(csvCell(null), '')
    assert.strictEqual(csvCell(undefined), '')
  })

  test('cells that a spreadsheet would run as a formula are neutralised', () => {
    for (const s of ['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx']) {
      assert.ok(csvCell(s).replace(/^"/, '').startsWith("'"), s)
    }
  })

  test('toCsv: header row, CRLF line ends, BOM for Excel', () => {
    assert.strictEqual(toCsv(['a', 'b'], [[1, 'x'], [2, null]]), '﻿a,b\r\n1,x\r\n2,\r\n')
  })

  test('every report exports, also when empty', () => {
    const empty = emptyInsights({ preset: '7d', from: '2026-10-27', to: '2026-11-02', days: 7 })
    for (const name of INSIGHTS_REPORTS) {
      const csv = reportCsv(empty, name)
      assert.ok(csv.startsWith('﻿'), name)
      assert.ok(csv.split('\r\n')[0].length > 0, name)
    }
  })
})
