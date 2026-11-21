// ZP-543 / ZP-544 (view part): the feed's two views (clean, info), the owner's
// setting (CLEAN / INFO / AB) and the A/B assignment. Pure: no database, no DOM.
// The inline script is run in a node:vm sandbox with a stand-in document,
// location and localStorage, and must agree with resolveFeedView everywhere.
import { describe, test } from 'node:test'
import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import {
  FEED_VIEW_AB_STORAGE_KEY,
  FEED_VIEW_DEFAULT_MODE,
  FEED_VIEW_MODES,
  FEED_VIEW_PARAM,
  feedViewScript,
  infoActions,
  infoAvailability,
  infoPrimary,
  infoPrice,
  isFeedViewMode,
  noScriptView,
  parseFeedView,
  previewFromSearch,
  previewView,
  readDatasetView,
  resolveFeedView,
  serverViews,
  type FeedView,
  type FeedViewMode,
} from '../src/lib/storefront/feed-view'
import { SITE_SETTINGS_DEFAULTS, type SiteSettingsData } from '../src/lib/site-settings/schema'
import { validateSiteSettingsInput } from '../src/lib/site-settings/validate'
import { toPublicSiteSettings } from '../src/lib/site-settings/dto'
import { settingsRevalidateScope } from '../src/lib/site-settings/revalidate'
import { guideTips } from '../src/lib/storefront/feed-guide'

const ROOT = path.join(__dirname, '..')

/** A Storage stand-in. `mode`: ok, blocked (every call throws), readonly (setItem throws), forgetful (writes are lost). */
function store(initial: Record<string, string> = {}, mode: 'ok' | 'blocked' | 'readonly' | 'forgetful' = 'ok') {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem(key: string) {
      if (mode === 'blocked') throw new Error('SecurityError')
      return data.has(key) ? (data.get(key) as string) : null
    },
    setItem(key: string, value: string) {
      if (mode === 'blocked' || mode === 'readonly') throw new Error('QuotaExceededError')
      if (mode !== 'forgetful') data.set(key, String(value))
    },
  }
}

/** Runs the inline script like a browser would; returns <html>'s data attributes and the store. */
function runScript(input: {
  mode: FeedViewMode
  search?: string
  storage?: ReturnType<typeof store> | 'missing'
  random?: number
  preset?: Record<string, string>
}) {
  const attrs = new Map<string, string>(Object.entries(input.preset ?? {}))
  const documentElement = {
    setAttribute: (k: string, v: string) => void attrs.set(k, String(v)),
    removeAttribute: (k: string) => void attrs.delete(k),
    getAttribute: (k: string) => attrs.get(k) ?? null,
  }
  const storage = input.storage === undefined ? store() : input.storage
  const sandbox: Record<string, unknown> = {
    document: { documentElement },
    location: { search: input.search ?? '' },
    URLSearchParams,
    Math: { random: () => input.random ?? 0.1 },
  }
  if (storage === 'missing') {
    Object.defineProperty(sandbox, 'localStorage', {
      get() {
        throw new Error('SecurityError: access denied')
      },
    })
  } else sandbox.localStorage = storage
  vm.runInNewContext(feedViewScript(input.mode), sandbox)
  return { view: attrs.get('data-feed-view') ?? null, test: attrs.get('data-feed-view-test') ?? null, storage }
}

describe('feed view: modes and parsing', () => {
  test('setting values, default and keys (shared contract)', () => {
    assert.deepStrictEqual([...FEED_VIEW_MODES], ['CLEAN', 'INFO', 'AB'])
    assert.strictEqual(FEED_VIEW_DEFAULT_MODE, 'CLEAN')
    assert.strictEqual(FEED_VIEW_AB_STORAGE_KEY, 'vyra:feed:view-ab')
    assert.strictEqual(FEED_VIEW_PARAM, 'view')
    for (const m of FEED_VIEW_MODES) assert.ok(isFeedViewMode(m))
    for (const bad of ['clean', 'ab', '', null, undefined, 1, 'INFO ']) assert.strictEqual(isFeedViewMode(bad), false)
  })

  test('parseFeedView: only exactly "clean" or "info"', () => {
    assert.strictEqual(parseFeedView('clean'), 'clean')
    assert.strictEqual(parseFeedView('info'), 'info')
    for (const bad of ['Info', 'INFO', ' info', '', null, undefined, 0, 'clean,info']) assert.strictEqual(parseFeedView(bad), null)
  })

  test('preview parameter: ?view=clean|info, first value wins, anything else ignored', () => {
    assert.strictEqual(previewView('info'), 'info')
    assert.strictEqual(previewView(['clean', 'info']), 'clean')
    assert.strictEqual(previewView(undefined), null)
    assert.strictEqual(previewView('both'), null)
    assert.strictEqual(previewFromSearch('?view=info'), 'info')
    assert.strictEqual(previewFromSearch('?c=dresses&view=clean'), 'clean')
    assert.strictEqual(previewFromSearch('view=info&view=clean'), 'info')
    assert.strictEqual(previewFromSearch('?view=INFO'), null)
    assert.strictEqual(previewFromSearch(''), null)
  })

  test('no JavaScript: fixed modes show their view, A/B shows clean', () => {
    assert.strictEqual(noScriptView('CLEAN'), 'clean')
    assert.strictEqual(noScriptView('INFO'), 'info')
    assert.strictEqual(noScriptView('AB'), 'clean')
  })

  test('server render: one view when it is known, both (CSS picks) only for A/B', () => {
    assert.deepStrictEqual(serverViews('CLEAN', undefined), ['clean'])
    assert.deepStrictEqual(serverViews('INFO', undefined), ['info'])
    assert.deepStrictEqual(serverViews('AB', undefined), ['clean', 'info'])
    assert.deepStrictEqual(serverViews('CLEAN', 'info'), ['info'])
    assert.deepStrictEqual(serverViews('AB', 'clean'), ['clean'])
    assert.deepStrictEqual(serverViews('INFO', 'nonsense'), ['info'])
  })

  test('readDatasetView reads <html data-feed-view> exactly', () => {
    assert.strictEqual(readDatasetView({ feedView: 'info' }), 'info')
    assert.strictEqual(readDatasetView({ feedView: 'x' }), null)
    assert.strictEqual(readDatasetView({}), null)
  })
})

describe('feed view: resolveFeedView', () => {
  const half = (r: number) => () => r

  test('fixed modes never touch storage and are never a test visit', () => {
    const s = store()
    assert.deepStrictEqual(resolveFeedView({ mode: 'CLEAN', preview: null, storage: s, random: half(0.9) }), { view: 'clean', test: false })
    assert.deepStrictEqual(resolveFeedView({ mode: 'INFO', preview: null, storage: s, random: half(0.1) }), { view: 'info', test: false })
    assert.strictEqual(s.data.size, 0)
  })

  test('A/B, fresh browser: 50/50 pick, stored, a test visit', () => {
    const low = store()
    assert.deepStrictEqual(resolveFeedView({ mode: 'AB', preview: null, storage: low, random: half(0.49) }), { view: 'clean', test: true })
    assert.strictEqual(low.data.get(FEED_VIEW_AB_STORAGE_KEY), 'clean')
    const high = store()
    assert.deepStrictEqual(resolveFeedView({ mode: 'AB', preview: null, storage: high, random: half(0.5) }), { view: 'info', test: true })
    assert.strictEqual(high.data.get(FEED_VIEW_AB_STORAGE_KEY), 'info')
  })

  test('A/B, returning browser keeps its view whatever the dice say', () => {
    for (const kept of ['clean', 'info'] as const) {
      for (const r of [0, 0.3, 0.7, 0.99]) {
        const s = store({ [FEED_VIEW_AB_STORAGE_KEY]: kept })
        assert.deepStrictEqual(resolveFeedView({ mode: 'AB', preview: null, storage: s, random: half(r) }), { view: kept, test: true })
      }
    }
  })

  test('A/B, a garbled stored value is replaced', () => {
    const s = store({ [FEED_VIEW_AB_STORAGE_KEY]: 'INFO' })
    assert.deepStrictEqual(resolveFeedView({ mode: 'AB', preview: null, storage: s, random: half(0.8) }), { view: 'info', test: true })
    assert.strictEqual(s.data.get(FEED_VIEW_AB_STORAGE_KEY), 'info')
  })

  test('A/B, storage blocked / not writable / missing: random per load and NOT a test visit', () => {
    for (const storage of [store({}, 'blocked'), store({}, 'readonly'), store({}, 'forgetful'), null]) {
      assert.deepStrictEqual(resolveFeedView({ mode: 'AB', preview: null, storage, random: half(0.2) }), { view: 'clean', test: false })
      assert.deepStrictEqual(resolveFeedView({ mode: 'AB', preview: null, storage, random: half(0.7) }), { view: 'info', test: false })
    }
  })

  test('preview wins over every mode, is never a test visit and is never stored', () => {
    for (const mode of FEED_VIEW_MODES) {
      for (const preview of ['clean', 'info'] as const) {
        const s = store()
        assert.deepStrictEqual(resolveFeedView({ mode, preview, storage: s, random: half(0.9) }), { view: preview, test: false })
        assert.strictEqual(s.data.size, 0)
      }
    }
  })

  test('the split is about 50/50', () => {
    let info = 0
    let seed = 7
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
    for (let i = 0; i < 4000; i++) if (resolveFeedView({ mode: 'AB', preview: null, storage: store(), random: rand }).view === 'info') info++
    assert.ok(info > 1800 && info < 2200, `info ${info} of 4000`)
  })
})

describe('feed view: the inline script (runs before first paint)', () => {
  test('is a self-contained expression with the mode baked in; an unknown mode is CLEAN', () => {
    const src = feedViewScript('AB')
    assert.ok(src.includes('"AB"'))
    assert.ok(src.includes(JSON.stringify(FEED_VIEW_AB_STORAGE_KEY)))
    assert.ok(!src.includes('</'), 'nothing that could close the <script> element')
    assert.strictEqual(feedViewScript('<\/script>' as FeedViewMode), feedViewScript('CLEAN'))
  })

  test('agrees with resolveFeedView in every case', () => {
    type Case = { mode: FeedViewMode; search: string; stored: string | null; storeMode: 'ok' | 'blocked' | 'readonly' | 'forgetful'; random: number }
    const cases: Case[] = []
    for (const mode of FEED_VIEW_MODES)
      for (const search of ['', '?view=info', '?view=clean', '?view=bad', '?c=x&view=info'])
        for (const stored of [null, 'clean', 'info', 'junk'])
          for (const storeMode of ['ok', 'blocked', 'readonly', 'forgetful'] as const)
            for (const random of [0.1, 0.9]) cases.push({ mode, search, stored, storeMode, random })
    for (const c of cases) {
      const initial: Record<string, string> = c.stored === null ? {} : { [FEED_VIEW_AB_STORAGE_KEY]: c.stored }
      const ran = runScript({ mode: c.mode, search: c.search, storage: store(initial, c.storeMode), random: c.random })
      const expected = resolveFeedView({
        mode: c.mode,
        preview: previewFromSearch(c.search),
        storage: store(initial, c.storeMode),
        random: () => c.random,
      })
      assert.deepStrictEqual({ view: ran.view, test: ran.test === '1' }, expected, JSON.stringify(c))
    }
  })

  test('localStorage itself throwing on access (blocked cookies) is handled', () => {
    const r = runScript({ mode: 'AB', storage: 'missing', random: 0.9 })
    assert.deepStrictEqual({ view: r.view, test: r.test }, { view: 'info', test: null })
  })

  test('a stale test flag is removed when the view is not from the assignment', () => {
    const r = runScript({ mode: 'AB', search: '?view=clean', preset: { 'data-feed-view-test': '1' } })
    assert.deepStrictEqual({ view: r.view, test: r.test }, { view: 'clean', test: null })
  })

  test('A/B: a fresh browser gets one view and keeps it on reload', () => {
    const s = store()
    const first = runScript({ mode: 'AB', storage: s, random: 0.8 })
    const again = runScript({ mode: 'AB', storage: s, random: 0.1 })
    assert.deepStrictEqual([first.view, again.view, first.test, again.test], ['info', 'info', '1', '1'])
  })
})

describe('feed view: the info panel', () => {
  const item = (over: Partial<{ soldOut: boolean; badge: { kind: 'sold-out' | 'few-left' | 'new'; label: string } | null; price: string; enquireHref: string | null; shareUrl: string | null }> = {}) => ({
    soldOut: false,
    badge: null,
    price: '$65',
    enquireHref: 'https://wa.me/263770000000?text=x',
    shareUrl: 'https://vyra.example/p/x',
    ...over,
  })

  test('availability tag from the existing badge data', () => {
    assert.deepStrictEqual(infoAvailability(item()), { kind: 'in-stock', label: 'In stock' })
    assert.deepStrictEqual(infoAvailability(item({ badge: { kind: 'new', label: 'New' } })), { kind: 'in-stock', label: 'In stock' })
    assert.deepStrictEqual(infoAvailability(item({ badge: { kind: 'few-left', label: 'Few left' } })), { kind: 'few-left', label: 'Few left' })
    assert.deepStrictEqual(infoAvailability(item({ soldOut: true, badge: { kind: 'sold-out', label: 'Sold out' } })), { kind: 'sold-out', label: 'Sold out' })
  })

  test('price line: "US$65" style, or Ask for price', () => {
    assert.strictEqual(infoPrice('$65'), 'US$65')
    assert.strictEqual(infoPrice('$65.50'), 'US$65.50')
    assert.strictEqual(infoPrice('Ask for price'), 'Ask for price')
  })

  test('primary button: Ask price on WhatsApp (ZP-1018), Ask about restock (sold out), Visit us (no WhatsApp)', () => {
    assert.deepStrictEqual(infoPrimary(item()), { kind: 'ask', label: 'Ask price on WhatsApp' })
    assert.deepStrictEqual(infoPrimary(item({ badge: { kind: 'few-left', label: 'Few left' } })), { kind: 'ask', label: 'Ask price on WhatsApp' })
    assert.deepStrictEqual(infoPrimary(item({ soldOut: true })), { kind: 'restock', label: 'Ask about restock' })
    assert.deepStrictEqual(infoPrimary(item({ enquireHref: null })), { kind: 'visit', label: 'Visit us' })
    assert.deepStrictEqual(infoPrimary(item({ enquireHref: null, soldOut: true })), { kind: 'visit', label: 'Visit us' })
  })

  test('the round buttons above the panel: save, share (with a URL), Call (with a phone); no eye', () => {
    assert.deepStrictEqual(infoActions({ share: true, call: true }), ['love', 'share', 'call'])
    assert.deepStrictEqual(infoActions({ share: false, call: false }), ['love'])
    assert.deepStrictEqual(infoActions({ share: true, call: false, preview: true }), ['share'])
  })
})

describe('feed view: the pop-up tips', () => {
  test('clean view is unchanged; info view (ZP-1018): Show details for the price and buttons, WhatsApp and Call on the right', () => {
    for (const layout of ['touch', 'desktop'] as const) {
      const clean = guideTips(layout)
      assert.deepStrictEqual(guideTips(layout, 'clean'), clean)
      const info = guideTips(layout, 'info')
      assert.strictEqual(info.length, clean.length)
      assert.ok(!info.some((t) => t.icon === 'eye' || /eye/i.test(t.title)))
      const eyeAt = clean.findIndex((t) => t.icon === 'eye')
      assert.strictEqual(info[eyeAt].icon, 'panel')
      assert.match(info[eyeAt].title, layout === 'desktop' ? /^Click Show details$/ : /^Tap Show details$/)
      assert.match(info[eyeAt].body, /price/)
      assert.match(info[eyeAt].body, /buttons/)
      assert.ok(!info.some((t) => /Reserve/.test(t.title + t.body)), 'no Reserve wording left')
      const contactAt = clean.findIndex((t) => t.icon === 'contact')
      assert.match(info[contactAt].title + ' ' + info[contactAt].body, /on the right/)
      assert.match(info[contactAt].title, /WhatsApp/)
      assert.match(info[contactAt].title, /Call/)
      // Every other tip is clean view's.
      const same = (_: unknown, i: number) => i !== eyeAt && i !== contactAt
      assert.deepStrictEqual(info.filter(same), clean.filter(same))
    }
  })
})

describe('feed view: the setting', () => {
  const base: SiteSettingsData = { ...SITE_SETTINGS_DEFAULTS }

  test('default CLEAN, and the defaults validate', () => {
    assert.strictEqual(SITE_SETTINGS_DEFAULTS.feedView, 'CLEAN')
    assert.deepStrictEqual(validateSiteSettingsInput({ feedView: SITE_SETTINGS_DEFAULTS.feedView }), { ok: true, value: { feedView: 'CLEAN' } })
  })

  test('validation: exactly CLEAN, INFO or AB', () => {
    for (const v of FEED_VIEW_MODES) assert.deepStrictEqual(validateSiteSettingsInput({ feedView: v }), { ok: true, value: { feedView: v } })
    for (const bad of ['clean', 'info', 'ab', 'BOTH', '', null, 1, true]) {
      const r = validateSiteSettingsInput({ feedView: bad })
      assert.strictEqual(r.ok, false, String(bad))
      if (!r.ok) assert.ok(r.errors.feedView)
    }
  })

  test('the public settings DTO is unchanged (the mode has its own cached read)', () => {
    assert.ok(!('feedView' in toPublicSiteSettings({ ...base, feedView: 'AB' })))
  })

  test('readFeedViewMode: the stored mode, CLEAN without a row', async () => {
    const { readFeedViewMode } = await import('../src/lib/site-settings/db')
    const db = (row: { feedView: FeedViewMode } | null) =>
      ({ siteSettings: { findUnique: async () => row } }) as unknown as Parameters<typeof readFeedViewMode>[0]
    assert.strictEqual(await readFeedViewMode(db(null)), 'CLEAN')
    assert.strictEqual(await readFeedViewMode(db({ feedView: 'AB' })), 'AB')
  })

  test('a change expires the settings entry (next page load), not the whole storefront', () => {
    assert.deepStrictEqual(settingsRevalidateScope(base, { ...base, feedView: 'INFO' }), { settings: true })
  })

  test('migration: enum CLEAN/INFO/AB, column NOT NULL DEFAULT CLEAN (= SITE_SETTINGS_DEFAULTS)', () => {
    const sql = readFileSync(path.join(ROOT, 'prisma/migrations/20261117090000_feed_view_setting/migration.sql'), 'utf8')
    assert.match(sql, /CREATE TYPE "FeedView" AS ENUM \('CLEAN', 'INFO', 'AB'\);/)
    assert.match(sql, /ALTER TABLE "SiteSettings" ADD COLUMN\s+"feedView" "FeedView" NOT NULL DEFAULT 'CLEAN';/)
    assert.ok(sql.includes(`DEFAULT '${SITE_SETTINGS_DEFAULTS.feedView}'`))
    // Nothing else: no data changes, no other table.
    const statements = sql.replace(/--.*$/gm, '').split(';').map((s) => s.trim()).filter(Boolean)
    assert.strictEqual(statements.length, 2)
    const schema = readFileSync(path.join(ROOT, 'prisma/schema.prisma'), 'utf8')
    assert.match(schema, /enum FeedView \{\s*CLEAN\s+INFO\s+AB\s*\}/)
    assert.match(schema, /feedView\s+FeedView\s+@default\(CLEAN\)/)
  })

  test('the type stays in step', () => {
    const v: FeedView = noScriptView(SITE_SETTINGS_DEFAULTS.feedView)
    assert.strictEqual(v, 'clean')
  })
})
