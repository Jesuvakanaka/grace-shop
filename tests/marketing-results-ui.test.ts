// ZP-1200: pure helpers of the Results, Ads and Audiences screens. No database.
import { describe, test } from 'node:test'
import assert from 'node:assert'
import { adBlockNote, adButtons, capPercent, defaultRange, enquiryRate, usd } from '../src/lib/marketing/ui'

describe('ad buttons follow the ad machine', () => {
  const actions = (s: string) => adButtons(s, 500).map((b) => b.action)
  test('each status offers only its next step', () => {
    assert.deepStrictEqual(actions('DRAFT'), ['submit', 'cancel'])
    assert.deepStrictEqual(actions('PENDING_APPROVAL'), ['approve', 'reject'])
    assert.deepStrictEqual(actions('APPROVED'), ['create_on_platform', 'cancel'])
    assert.deepStrictEqual(actions('PAUSED_ON_PLATFORM'), ['start', 'cancel'])
    assert.deepStrictEqual(actions('ACTIVE'), ['pause'])
    assert.deepStrictEqual(actions('FAILED'), ['create_on_platform', 'cancel'])
    assert.deepStrictEqual(actions('COMPLETED'), [])
  })
  test('start asks first and names the daily amount; nothing else spends without start', () => {
    const start = adButtons('PAUSED_ON_PLATFORM', 750).find((b) => b.action === 'start')!
    assert.match(start.confirm ?? '', /\$7\.50 a day/)
    assert.ok(!adButtons('APPROVED', 750).some((b) => b.action === 'start'))
  })
})

describe('budget helpers', () => {
  test('usd and capPercent', () => {
    assert.strictEqual(usd(1750), '$17.50')
    assert.deepStrictEqual([capPercent(2500, 5000), capPercent(9000, 5000), capPercent(100, 0), capPercent(-5, 100)], [50, 100, 0, 0])
  })
  test('adBlockNote names every reason and is null when nothing blocks', () => {
    const ok = { env: true, settings: true, connectedChannels: 1 }
    assert.strictEqual(adBlockNote(ok, 5000), null)
    assert.match(adBlockNote(ok, 0) ?? '', /limit is \$0\.00/)
    assert.match(adBlockNote({ ...ok, env: false }, 5000) ?? '', /switched off on this server/)
    assert.match(adBlockNote({ ...ok, settings: false }, 5000) ?? '', /live switch is off/)
    assert.match(adBlockNote({ ...ok, connectedChannels: 0 }, 5000) ?? '', /no channel is connected/)
  })
})

describe('results helpers', () => {
  test('defaultRange is 30 days ending today', () => {
    assert.deepStrictEqual(defaultRange(new Date('2026-11-26T10:00:00Z')), { from: '2026-10-28', to: '2026-11-26' })
  })
  test('enquiryRate', () => {
    assert.strictEqual(enquiryRate(0, 0), '–')
    assert.strictEqual(enquiryRate(20, 5), '25%')
  })
})
