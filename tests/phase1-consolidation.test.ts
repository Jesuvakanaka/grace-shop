// Phase 1 consolidation (pure parts): one revalidation helper, settings-driven
// revalidation scope, and srcset on storefront cards.
import { describe, test } from 'node:test'
import assert from 'node:assert'
import { revalidateStorefront as realRevalidate, STOREFRONT_TAGS } from '../src/lib/storefront/cache-tags'
import * as shim from '../src/lib/website/revalidate'
import { revalidateSiteSettings, settingsRevalidateScope } from '../src/lib/site-settings/revalidate'
import { SITE_SETTINGS_DEFAULTS } from '../src/lib/site-settings/schema'

function recorder() {
  const calls: [string, unknown][] = []
  return { calls, deps: { revalidateTag: (tag: string, profile: { expire: number }) => void calls.push([tag, profile]) } }
}

describe('one revalidation helper', () => {
  test('the shim IS the ZP-484 helper underneath (same tags for every scope)', () => {
    const scopes = [undefined, { productSlugs: ['a', 'b'] }, { categorySlugs: ['c'] }, { productSlugs: ['a'], categorySlugs: ['c'] }]
    for (const scope of scopes) assert.deepStrictEqual(shim.storefrontTagsFor(scope), realRevalidate(scope, recorder().deps))
    assert.strictEqual(shim.STOREFRONT_TAGS, STOREFRONT_TAGS)
  })

  test('the ZP-484 helper skips null and invalid slugs', () => {
    assert.deepStrictEqual(realRevalidate({ productSlugs: [null, undefined, 'ok', 'Bad!'] }, recorder().deps), [
      'storefront:products',
      'storefront:product:ok',
    ])
  })

  test('settings scope: storefront:settings and storefront:home', () => {
    const r = recorder()
    assert.deepStrictEqual(realRevalidate({ settings: true }, r.deps), ['storefront:settings', 'storefront:home'])
    assert.deepStrictEqual(r.calls, [
      ['storefront:settings', { expire: 0 }],
      ['storefront:home', { expire: 0 }],
    ])
  })

  test('safe wrapper: swallows only the "outside a request" error, logs anything else, never throws', () => {
    const logged: unknown[][] = []
    const original = console.error
    console.error = (...args: unknown[]) => void logged.push(args)
    try {
      const outside = shim.revalidateStorefrontSafely({ productSlugs: ['x'] }, () => {
        throw new Error('Invariant: static generation store missing in revalidateTag("storefront:products")')
      })
      assert.deepStrictEqual(outside, { tags: ['storefront:products', 'storefront:product:x'], failed: [] })
      assert.strictEqual(logged.length, 0)

      const broken = shim.revalidateStorefrontSafely(undefined, () => {
        throw new Error('boom')
      })
      assert.deepStrictEqual(broken, { tags: ['storefront'], failed: ['storefront'] })
      assert.strictEqual(logged.length, 1)
    } finally {
      console.error = original
    }
  })
})

describe('site settings revalidation', () => {
  const base = { ...SITE_SETTINGS_DEFAULTS }

  test('a changed few-left threshold expires the whole storefront; anything else only settings', () => {
    assert.strictEqual(settingsRevalidateScope(base, { ...base, fewLeftThreshold: 5 }), undefined)
    assert.deepStrictEqual(settingsRevalidateScope(base, { ...base, heroHeadline: 'New' }), { settings: true })
    assert.deepStrictEqual(settingsRevalidateScope(base, base), { settings: true })
  })

  test('revalidateSiteSettings expires the tags for that scope', () => {
    const r = recorder()
    assert.deepStrictEqual(revalidateSiteSettings(undefined, r.deps.revalidateTag), { ok: true, tags: ['storefront'] })
    assert.deepStrictEqual(r.calls, [['storefront', { expire: 0 }]])
    const s = recorder()
    assert.deepStrictEqual(revalidateSiteSettings({ settings: true }, s.deps.revalidateTag), {
      ok: true,
      tags: ['storefront:settings', 'storefront:home'],
    })
  })
})
