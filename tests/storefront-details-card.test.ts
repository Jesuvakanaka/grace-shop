/**
 * ZP-513: the details card's new content, pure parts.
 * - Size charts (src/lib/storefront-model/size-chart.ts): admin validation,
 *   lenient read of stored JSON, rows for the piece's sizes.
 * - Admin allow-lists: product fitNote / fabric / care / sizeChart; site
 *   settings holdHours / paymentMethods / defaultSizeChart (and their public DTO).
 * - The card model (src/lib/storefront/feed-sheet.ts): social line, how to
 *   buy, colour / size label, description toggle, "Try it on", also-like.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert'
import {
  chartForSizes,
  parseSizeChart,
  readSizeChart,
  SIZE_CHART_MAX_ROWS,
  sizeChartFromText,
  sizeChartToText,
} from '../src/lib/storefront-model/size-chart'
import { parseProductWebsitePatch } from '../src/lib/website/validation'
import { validateSiteSettingsInput } from '../src/lib/site-settings/validate'
import { SITE_SETTINGS_DEFAULTS } from '../src/lib/site-settings/schema'
import { toPublicSiteSettings } from '../src/lib/site-settings/dto'
import {
  alsoLikeTitle,
  chosenColour,
  colourSizeLabel,
  descriptionToggle,
  howToBuy,
  pickAlsoLike,
  socialLine,
  tryItOnText,
} from '../src/lib/storefront/feed-sheet'

const S = { size: 'S', bust: '86–90', waist: '68–72', hips: '94–98' }
const M = { size: 'M', bust: '91–95', waist: '73–77', hips: '99–103' }
const L = { size: 'L', bust: '96–101', waist: '78–83', hips: '104–109' }

describe('size chart', () => {
  test('parseSizeChart: rows of size / bust / waist / hips, trimmed; empty means none', () => {
    assert.deepStrictEqual(parseSizeChart([{ size: ' S ', bust: '86–90', waist: '68–72', hips: '94–98' }]), { ok: true, value: [S] })
    assert.deepStrictEqual(parseSizeChart([{ size: 'M', bust: 92, waist: 74, hips: 100 }]), {
      ok: true,
      value: [{ size: 'M', bust: '92', waist: '74', hips: '100' }],
    })
    assert.deepStrictEqual(parseSizeChart([]), { ok: true, value: null })
    assert.deepStrictEqual(parseSizeChart(null), { ok: true, value: null })
    assert.deepStrictEqual(parseSizeChart(''), { ok: true, value: null })
  })
  test('parseSizeChart: a JSON string is accepted (the admin textarea)', () => {
    assert.deepStrictEqual(parseSizeChart(JSON.stringify([S, M])), { ok: true, value: [S, M] })
  })
  test('parseSizeChart refuses bad input', () => {
    for (const bad of [
      '{not json',
      { size: 'S' },
      [{ bust: '1', waist: '1', hips: '1' }],
      [{ size: '', bust: '1', waist: '1', hips: '1' }],
      [{ size: 'S', bust: '1', waist: '1', hips: '1', extra: 'x' }],
      [{ size: 'S'.repeat(13), bust: '1', waist: '1', hips: '1' }],
      [{ size: 'S', bust: '1'.repeat(17), waist: '1', hips: '1' }],
      [S, { ...S }],
      Array.from({ length: SIZE_CHART_MAX_ROWS + 1 }, (_, i) => ({ size: `S${i}`, bust: '1', waist: '1', hips: '1' })),
      [{ size: 'S', bust: '<b>', waist: '1', hips: '1' }],
    ]) {
      const r = parseSizeChart(bad)
      assert.strictEqual(r.ok, false, JSON.stringify(bad).slice(0, 60))
    }
  })
  test('admin text form: one row per line, "size | bust | waist | hips"', () => {
    assert.strictEqual(sizeChartToText([S, M]), 'S | 86–90 | 68–72 | 94–98\nM | 91–95 | 73–77 | 99–103')
    assert.strictEqual(sizeChartToText(null), '')
    assert.deepStrictEqual(sizeChartFromText(' S | 86–90 | 68–72 | 94–98 \n\nM|91–95|73–77|99–103\n'), { ok: true, rows: [S, M] })
    assert.deepStrictEqual(sizeChartFromText('  \n'), { ok: true, rows: [] })
    // A short line keeps its missing measurements empty.
    assert.deepStrictEqual(sizeChartFromText('XL | 102'), { ok: true, rows: [{ size: 'XL', bust: '102', waist: '', hips: '' }] })
  })
  test('review: the text form refuses more than 4 cells and rows without any measurement, naming the line', () => {
    assert.deepStrictEqual(sizeChartFromText('S | 86 | 68 | 94\nM | 91 | 73 | 99 | 120'), {
      ok: false,
      error: 'Line 2 has more than 4 parts. Use: size | bust | waist | hips.',
    })
    assert.deepStrictEqual(sizeChartFromText('S | 86 | 68 | 94\nXL'), {
      ok: false,
      error: 'Line 2 (XL) has no measurements. Add bust, waist or hips.',
    })
    assert.deepStrictEqual(sizeChartFromText('XL |  |  | '), { ok: false, error: 'Line 1 (XL) has no measurements. Add bust, waist or hips.' })
  })
  test('review: the server refuses rows with no measurement at all', () => {
    const r = parseSizeChart([{ size: 'XL', bust: '', waist: '', hips: '' }])
    assert.strictEqual(r.ok, false)
  })

  test('readSizeChart: stored JSON that no longer validates reads as none', () => {
    assert.deepStrictEqual(readSizeChart([S]), [S])
    assert.strictEqual(readSizeChart({ nope: 1 }), null)
    assert.strictEqual(readSizeChart(null), null)
  })
  test("chartForSizes: the piece's chart, else the default; rows of its sizes only", () => {
    assert.deepStrictEqual(chartForSizes({ piece: null, fallback: [S, M, L], sizes: ['m', 'L'] }), [M, L])
    assert.deepStrictEqual(chartForSizes({ piece: [S], fallback: [S, M, L], sizes: ['S', 'M'] }), [S])
    assert.deepStrictEqual(chartForSizes({ piece: null, fallback: [S, M], sizes: [] }), [S, M])
    assert.strictEqual(chartForSizes({ piece: null, fallback: null, sizes: ['S'] }), null)
    assert.strictEqual(chartForSizes({ piece: null, fallback: [S], sizes: ['XL'] }), null)
  })
})

describe('admin allow-lists', () => {
  test('product: fitNote <= 160, fabric / care <= 80, sizeChart validated', () => {
    const ok = parseProductWebsitePatch({ fitNote: ' Model is 1.70 m ', fabric: 'Stretch velvet', care: 'Hand wash cold', sizeChart: [S] })
    assert.deepStrictEqual(ok, { ok: true, data: { fitNote: 'Model is 1.70 m', fabric: 'Stretch velvet', care: 'Hand wash cold', sizeChart: [S] } })
    assert.deepStrictEqual(parseProductWebsitePatch({ fitNote: '', sizeChart: null }), { ok: true, data: { fitNote: null, sizeChart: null } })
    assert.strictEqual(parseProductWebsitePatch({ fitNote: 'x'.repeat(161) }).ok, false)
    assert.strictEqual(parseProductWebsitePatch({ fabric: 'x'.repeat(81) }).ok, false)
    assert.strictEqual(parseProductWebsitePatch({ care: 'x'.repeat(81) }).ok, false)
    assert.strictEqual(parseProductWebsitePatch({ sizeChart: [{ size: 'S' }] }).ok, false)
  })
  test('settings: holdHours (1..168 or empty), paymentMethods <= 80, defaultSizeChart', () => {
    // Owner (review): no "We hold it" line until the owner sets the hours.
    assert.strictEqual(SITE_SETTINGS_DEFAULTS.holdHours, null)
    assert.strictEqual(SITE_SETTINGS_DEFAULTS.paymentMethods, null)
    assert.strictEqual(SITE_SETTINGS_DEFAULTS.defaultSizeChart, null)
    const r = validateSiteSettingsInput({ holdHours: 48, paymentMethods: 'EcoCash · cash · card', defaultSizeChart: [S, M] })
    assert.deepStrictEqual(r, { ok: true, value: { holdHours: 48, paymentMethods: 'EcoCash · cash · card', defaultSizeChart: [S, M] } })
    assert.deepStrictEqual(validateSiteSettingsInput({ holdHours: null, paymentMethods: '', defaultSizeChart: [] }), {
      ok: true,
      value: { holdHours: null, paymentMethods: null, defaultSizeChart: null },
    })
    for (const bad of [{ holdHours: 0 }, { holdHours: 169 }, { holdHours: 1.5 }, { paymentMethods: 'x'.repeat(81) }, { defaultSizeChart: 'nope' }]) {
      assert.strictEqual(validateSiteSettingsInput(bad).ok, false, JSON.stringify(bad))
    }
  })
  test('public settings: buying block (hold hours, payment methods, default size chart)', () => {
    const dto = toPublicSiteSettings({ ...SITE_SETTINGS_DEFAULTS, holdHours: 24, paymentMethods: 'EcoCash · cash', defaultSizeChart: [S] })
    assert.deepStrictEqual(dto.buying, { holdHours: 24, paymentMethods: 'EcoCash · cash', sizeChart: [S] })
  })
})

describe('card model', () => {
  test('social line: real numbers only, each part from 3', () => {
    assert.strictEqual(socialLine({ loves: 24, asked: 6 }), 'Loved by 24 · 6 people asked about it this week')
    assert.strictEqual(socialLine({ loves: 24, asked: 2 }), 'Loved by 24')
    assert.strictEqual(socialLine({ loves: 2, asked: 3 }), '3 people asked about it this week')
    assert.strictEqual(socialLine({ loves: 0, asked: 0 }), null)
  })

  test('how to buy: cells with data only; none -> empty', () => {
    const full = howToBuy({ soldOut: false, hasWhatsApp: true, holdHours: 24, paymentMethods: 'EcoCash · cash · card', todayText: 'Open today 09:00–17:30' })
    assert.deepStrictEqual(full, [
      { kind: 'reserve', title: 'Reserve on WhatsApp', text: 'We hold it for 24 h' },
      { kind: 'pay', title: 'Pay in store', text: 'EcoCash · cash · card' },
      { kind: 'collect', title: 'Collect in store', text: 'Open today 09:00–17:30' },
    ])
    assert.deepStrictEqual(howToBuy({ soldOut: true, hasWhatsApp: true, holdHours: 24, paymentMethods: null, todayText: null }), [
      { kind: 'reserve', title: 'Ask about restock', text: 'We message you when it’s back' },
    ])
    // No hold time: the reserve cell keeps its title only.
    assert.deepStrictEqual(howToBuy({ soldOut: false, hasWhatsApp: true, holdHours: null, paymentMethods: null, todayText: null }), [
      { kind: 'reserve', title: 'Reserve on WhatsApp', text: null },
    ])
    assert.deepStrictEqual(howToBuy({ soldOut: false, hasWhatsApp: false, holdHours: 24, paymentMethods: null, todayText: null }), [])
  })

  test('colour / size label: a picker only with more than one colour', () => {
    assert.deepStrictEqual(colourSizeLabel(['Olive'], ['S', 'M']), { picker: false, colour: 'Olive', label: 'Size' })
    assert.deepStrictEqual(colourSizeLabel(['Olive', 'Cream'], ['S']), { picker: true, colour: null, label: 'Size' })
    assert.deepStrictEqual(colourSizeLabel([], ['S']), { picker: false, colour: null, label: 'Size' })
    assert.deepStrictEqual(colourSizeLabel(['Olive'], []), { picker: false, colour: 'Olive', label: null })
    assert.strictEqual(colourSizeLabel([], []), null)
  })

  test('description toggle: "More · fabric & care" with fabric or care, "More" for a long text, else none', () => {
    assert.strictEqual(descriptionToggle({ description: 'Short.', fabric: 'Velvet', care: null }), 'More · fabric & care')
    assert.strictEqual(descriptionToggle({ description: 'x'.repeat(140), fabric: null, care: null }), 'More')
    assert.strictEqual(descriptionToggle({ description: 'Line one\nline two\nline three', fabric: null, care: null }), 'More')
    assert.strictEqual(descriptionToggle({ description: 'Short.', fabric: null, care: null }), null)
    assert.strictEqual(descriptionToggle({ description: null, fabric: null, care: 'Dry clean' }), 'More · fabric & care')
  })

  test('"Try it on" line: today\'s hours, lower-cased after the colon', () => {
    assert.strictEqual(tryItOnText('Open today 09:00–17:30'), 'open today 09:00–17:30')
    assert.strictEqual(tryItOnText('Closed today'), 'closed today')
    assert.strictEqual(tryItOnText(null), null)
  })

  test('review: a single colour goes into the WhatsApp message without a picker; a chosen one wins', () => {
    assert.strictEqual(chosenColour({ colours: ['Olive'], chosen: null }), 'Olive')
    assert.strictEqual(chosenColour({ colours: ['Olive', 'Cream'], chosen: null }), null)
    assert.strictEqual(chosenColour({ colours: ['Olive', 'Cream'], chosen: 'Cream' }), 'Cream')
    assert.strictEqual(chosenColour({ colours: [], chosen: null }), null)
  })

  test('also like: up to 4 available pieces, same collection first, then feed order; title on sold-out', () => {
    const p = (slug: string, category: string, soldOut = false) => ({ slug, category, soldOut })
    const ordered = [p('a', 'dresses'), p('b', 'sets'), p('c', 'dresses', true), p('d', 'dresses'), p('e', 'sets'), p('f', 'sets'), p('cur', 'dresses')]
    assert.deepStrictEqual(pickAlsoLike(ordered, { slug: 'cur', category: 'dresses' }).map((x) => x.slug), ['a', 'd', 'b', 'e'])
    assert.deepStrictEqual(pickAlsoLike([p('cur', 'x')], { slug: 'cur', category: 'x' }), [])
    assert.strictEqual(alsoLikeTitle(false), 'You may also like')
    assert.strictEqual(alsoLikeTitle(true), 'Available now')
  })
})
