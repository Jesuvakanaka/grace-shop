// The sales-led writer: the brief, true reasons to act now, the selling profile, the code checks,
// the second AI pass and the one rewrite. Fake AI clients, no network, no database.
import { describe, test } from 'node:test'
import assert from 'node:assert'
import Anthropic from '@anthropic-ai/sdk'
import { DEFAULT_ACTION, planFromContent, resolveUrgency, urgencyOptions, type BriefPlan } from '../src/lib/marketing/brief'
import { cleanProfile, buyerLine, doubtLine } from '../src/lib/marketing/profile-model'
import { profileSystem, profileUserText, writeProfile } from '../src/lib/marketing/ai/profile'
import { CHECK_SYSTEM, parseCheck, questionsFor } from '../src/lib/marketing/ai/check'
import { shopIdentity, DEFAULT_SHOP_DESCRIPTION } from '../src/lib/marketing/ai/shop'
import { briefBlock, draftPosts, softProblems, writerSystem, type DraftProduct } from '../src/lib/marketing/ai/writer'
import { draftSummary, swapOpening } from '../src/lib/marketing/ui'

const NOW = new Date('2026-11-27T10:00:00Z')
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000)
const stock = (extra: Record<string, unknown> = {}) => ({ published: true, publishedAt: days(-60), currentQuantity: 20, listingType: 'IN_STOCK', preorderShipFrom: null, ...extra })
const kinds = (o: { kind: string }[]) => o.map((x) => x.kind)

const product = (extra: Partial<DraftProduct> = {}): DraftProduct => ({
  productName: 'ZP Linen Dress',
  publicName: 'Linen Occasion Dress',
  publicDescription: 'A linen dress with a hand-smocked bodice and a soft cotton lining. Machine washable.',
  colours: 'Ivory, sage, blush',
  sizes: '2-8 years',
  sellingPriceUsd: 45,
  priceDisplay: 'SHOW_PRICE',
  ...extra,
})
const plan = (extra: Partial<BriefPlan> = {}): BriefPlan => ({
  job: 'OFFER_CLOSE',
  reader: 'A parent with a family wedding coming, and nothing suitable that fits',
  message: 'She looks dressed up and can still play all day',
  proof: 'Soft cotton lining, machine washable',
  urgency: null,
  action: 'Message us to order',
  ...extra,
})
const GOOD = 'The photos take ten minutes. The rest of the day is cousins, cake and running on the grass.\n\nThe soft cotton lining means no scratching. It goes straight in the machine afterwards.\n\nMessage us to order hers.'
const mp = (channel: string, text: string, extra: Record<string, unknown> = {}) => ({ channel, text, headline: null, description: null, subject: null, hashtags: [], openings: [] as string[], ...extra })
const pass = (channel: string) => ({ channel, answers: [] })
const fail = (channel: string, question: string, fix: string) => ({ channel, answers: [{ question, pass: false, fix }] })

/** A Claude that answers each call in turn and records what it was asked. */
function scripted(replies: unknown[]) {
  const calls: { system: string; prompt: string }[] = []
  const client = {
    messages: {
      create: async (args: { system: string; messages: { content: { text: string }[] }[] }) => {
        calls.push({ system: args.system, prompt: args.messages[0].content[0].text })
        const reply = replies[calls.length - 1]
        if (reply === undefined) throw new Error(`unexpected AI call ${calls.length}`)
        return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(reply) }], usage: { input_tokens: 1000, output_tokens: 500 } }
      },
    },
  } as unknown as Pick<Anthropic, 'messages'>
  return { client, calls }
}

describe('a reason to act now can only be a true one', () => {
  test('"None" and "my own reason" are always offered; nothing else without data behind it', () => {
    assert.deepStrictEqual(kinds(urgencyOptions(stock(), null, NOW)), ['NONE', 'OWN'])
    assert.deepStrictEqual(kinds(urgencyOptions(null, null, NOW)), ['NONE', 'OWN'])
  })

  test('few left only when stock is 1 to 3, with the real figure', () => {
    const o = urgencyOptions(stock({ currentQuantity: 3 }), null, NOW)
    assert.strictEqual(o.find((x) => x.kind === 'FEW_LEFT')?.text, 'Only 3 left in stock.')
    assert.ok(!kinds(urgencyOptions(stock({ currentQuantity: 4 }), null, NOW)).includes('FEW_LEFT'))
    assert.ok(!kinds(urgencyOptions(stock({ currentQuantity: 0 }), null, NOW)).includes('FEW_LEFT'))
  })

  test('new in only while the product is new; unpublished products are never "new in"', () => {
    assert.strictEqual(urgencyOptions(stock({ publishedAt: days(-3) }), null, NOW).find((x) => x.kind === 'NEW_IN')?.text, 'New in this week.')
    assert.strictEqual(urgencyOptions(stock({ publishedAt: days(-20) }), null, NOW).find((x) => x.kind === 'NEW_IN')?.text, 'A new arrival.')
    assert.ok(!kinds(urgencyOptions(stock({ publishedAt: days(-45) }), null, NOW)).includes('NEW_IN'))
    assert.ok(!kinds(urgencyOptions(stock({ publishedAt: days(-3), published: false }), null, NOW)).includes('NEW_IN'))
  })

  test('a pre-order gives its ship date and is never "few left"', () => {
    const o = urgencyOptions(stock({ listingType: 'PRE_ORDER', currentQuantity: 2, preorderShipFrom: new Date('2026-12-12T00:00:00Z') }), null, NOW)
    assert.strictEqual(o.find((x) => x.kind === 'PREORDER')?.text, 'On pre-order now, shipping from 12 December.')
    assert.ok(!kinds(o).includes('FEW_LEFT'))
    assert.ok(!kinds(urgencyOptions(stock({ listingType: 'PRE_ORDER', preorderShipFrom: days(-10) }), null, NOW)).includes('PREORDER'))
  })

  test('a campaign end counts only when it is ahead and near', () => {
    const o = urgencyOptions(null, { name: 'Christmas edit', endsAt: new Date('2026-12-04T15:00:00Z') }, NOW)
    assert.strictEqual(o.find((x) => x.kind === 'CAMPAIGN_ENDS')?.text, 'Christmas edit ends on Friday 4 December.')
    assert.ok(!kinds(urgencyOptions(null, { name: 'Old', endsAt: days(-1) }, NOW)).includes('CAMPAIGN_ENDS'))
    assert.ok(!kinds(urgencyOptions(null, { name: 'Far', endsAt: days(60) }, NOW)).includes('CAMPAIGN_ENDS'))
  })

  test('a chosen reason that stopped being true is dropped and flagged, never sent', () => {
    const now = urgencyOptions(stock({ currentQuantity: 9 }), null, NOW)
    assert.deepStrictEqual(resolveUrgency('FEW_LEFT', null, now), { text: null, stale: true })
    assert.deepStrictEqual(resolveUrgency('FEW_LEFT', null, urgencyOptions(stock({ currentQuantity: 2 }), null, NOW)), { text: 'Only 2 left in stock.', stale: false })
    assert.deepStrictEqual(resolveUrgency('OWN', ' Order by Friday for the concert ', now), { text: 'Order by Friday for the concert', stale: false })
    assert.deepStrictEqual(resolveUrgency('NONE', 'ignored', now), { text: null, stale: false })
    assert.deepStrictEqual(resolveUrgency(null, null, now), { text: null, stale: false })
  })
})

describe('the brief', () => {
  test('content made before the brief is an offer with the owner\'s words as the message', () => {
    const p = planFromContent({}, null, { message: 'New dresses are in' })
    assert.deepStrictEqual(p, { job: 'OFFER_CLOSE', reader: null, message: 'New dresses are in', proof: null, urgency: null, action: DEFAULT_ACTION.OFFER_CLOSE })
  })

  test('the action follows the job unless one was chosen; an unknown job is not trusted', () => {
    assert.strictEqual(planFromContent({ job: 'GET_SEEN' }, null).action, DEFAULT_ACTION.GET_SEEN)
    assert.strictEqual(planFromContent({ job: 'KEEP', action: 'Tell a friend' }, null).action, 'Tell a friend')
    assert.strictEqual(planFromContent({ job: 'SELL_HARD' }, null).job, 'OFFER_CLOSE')
  })

  test('the writer is told the job, reader, message, proof, action, and that there is NO urgency unless one is given', () => {
    const none = briefBlock({ product: product(), channels: ['X'], plan: plan() })
    assert.match(none, /Job: OFFER AND CLOSE/)
    assert.match(none, /Reader: A parent with a family wedding coming/)
    assert.match(none, /One message: She looks dressed up/)
    assert.match(none, /Proof: Soft cotton lining, machine washable/)
    assert.match(none, /Reason to act now: NONE\. Write no urgency\./)
    assert.match(none, /One action: Message us to order/)
    assert.match(briefBlock({ product: product(), channels: ['X'], plan: plan({ urgency: 'Only 2 left in stock.' }) }), /Reason to act now: Only 2 left in stock\./)
    assert.match(briefBlock({ product: product(), channels: ['X'] }), /Reader: not given/)
  })

  test('the fixed instructions carry the shop line, the five shapes and the truth rules', () => {
    const s = writerSystem(shopIdentity({ shopDescription: 'a family clothing shop in Harare.' }))
    assert.match(s, /^You write marketing for VYRA, a family clothing shop in Harare\. Your work is judged by one thing/)
    for (const j of ['GET SEEN:', 'EARN TRUST:', 'GET PERMISSION:', 'OFFER AND CLOSE:', 'KEEP CUSTOMERS:']) assert.ok(s.includes(j), j)
    assert.match(s, /Never invent a price, size, stock level, discount, material, delivery promise, review or customer/)
    assert.match(s, /write no urgency of any kind/)
    assert.match(s, /End with the one action from the brief/)
    assert.ok(writerSystem(shopIdentity(null)).includes(`VYRA, ${DEFAULT_SHOP_DESCRIPTION}.`))
  })
})

describe('the code checks what the AI wrote', () => {
  const ctx = (urgency: string | null = null) => ({ urgency, allowed: `${briefBlock({ product: product(), channels: ['X'], plan: plan({ urgency }) })}\nAges 2 to 8`, names: ['VYRA', 'Linen Occasion Dress'] })
  const post = (text: string) => ({ text, headline: null, description: null, subject: null })

  test('a clean draft has no problems', () => {
    assert.deepStrictEqual(softProblems(post(GOOD), ctx()), { truth: [], style: [] })
  })

  test('urgency the brief did not give is a truth problem; the brief\'s own reason is not', () => {
    for (const t of ['Hurry, these will not wait.', 'Only a few left!', 'Selling fast.', "Don't miss out.", 'While stocks last.', 'Limited stock.', 'Last chance to order.']) {
      assert.strictEqual(softProblems(post(`A dress for the day. ${t}`), ctx()).truth.length, 1, t)
    }
    assert.deepStrictEqual(softProblems(post('A dress for the day. Only 2 left in stock.'), ctx('Only 2 left in stock.')).truth, [])
  })

  test('a figure that is not in the brief or the facts is a truth problem; known ones and words are fine', () => {
    assert.match(softProblems(post('Loved by 200 families.'), ctx()).truth[0], /200/)
    assert.deepStrictEqual(softProblems(post('For ages 2 to 8, in {sizes} at {price}. Ten minutes of photos.'), ctx()).truth, [])
  })

  test('opening on the shop, the product or "Introducing" is a style problem, not a truth one', () => {
    for (const t of ['Introducing our new dress.', 'VYRA has a new dress.', 'Linen Occasion Dress, new in.', "We're excited to share this.", 'Meet the dress of the season.']) {
      const p = softProblems(post(`${t}\n\nMessage us to order.`), ctx())
      assert.strictEqual(p.style.length, 1, t)
      assert.deepStrictEqual(p.truth, [])
    }
  })
})

describe('the second AI pass', () => {
  const input = { briefText: 'b', factsText: 'f', job: 'OFFER_CLOSE' as const, drafts: [{ channel: 'FACEBOOK_PAGE', text: 't' }, { channel: 'SMS', text: 't', short: true }] }

  test('its instructions are the six questions', () => {
    for (const q of ['READER:', 'MESSAGE:', 'SPECIFIC:', 'PROOF:', 'ACTION:', 'TRUE:']) assert.ok(CHECK_SYSTEM.includes(q), q)
  })

  test('a "get seen" piece needs no proof; a very short channel keeps only opening, action and truth', () => {
    assert.ok(!questionsFor('GET_SEEN', false).includes('PROOF'))
    assert.ok(questionsFor('EARN_TRUST', false).includes('PROOF'))
    assert.deepStrictEqual(questionsFor('OFFER_CLOSE', true), ['READER', 'ACTION', 'TRUE'])
  })

  test('only failed questions that apply become fixes; unknown channels and junk are ignored', () => {
    const fixes = parseCheck({
      drafts: [
        { channel: 'FACEBOOK_PAGE', answers: [{ question: 'READER', pass: true, fix: null }, { question: 'ACTION', pass: false, fix: '  End with one action.  ' }, { question: 'PROOF', pass: false, fix: null }] },
        { channel: 'SMS', answers: [{ question: 'PROOF', pass: false, fix: 'Add the proof.' }, { question: 'TRUE', pass: false, fix: 'Remove the claim.' }] },
        { channel: 'NOPE', answers: [{ question: 'TRUE', pass: false, fix: 'x' }] },
        7,
      ],
    }, input)
    assert.deepStrictEqual(fixes, { FACEBOOK_PAGE: ['End with one action.'], SMS: ['Remove the claim.'] })
    assert.throws(() => parseCheck({ nope: 1 }, input), /expected shape/)
  })
})

describe('write, check, rewrite once', () => {
  test('a draft that passes is written once and checked once; alternative openings come back filled and true', async () => {
    const ai = scripted([
      { posts: [mp('FACEBOOK_PAGE', GOOD, { openings: ['She will be asked to sit still for exactly one photo.', 'Only $30 today!', 'Hurry, selling fast.', 'A dress for the wedding, in {sizes}.', 'A third opening that is one too many.'] })] },
      { drafts: [pass('FACEBOOK_PAGE')] },
    ])
    const r = await draftPosts({ product: product(), channels: ['FACEBOOK_PAGE'], plan: plan() }, { client: ai.client })
    assert.strictEqual(ai.calls.length, 2)
    assert.match(ai.calls[0].system, /^You write marketing for VYRA/)
    assert.match(ai.calls[0].prompt, /THE BRIEF\nJob: OFFER AND CLOSE/)
    assert.ok(!ai.calls[0].prompt.includes('45'), 'the price never reaches the AI')
    assert.match(ai.calls[1].system, /^You are checking draft posts/)
    assert.ok(ai.calls[1].prompt.includes(GOOD))
    assert.strictEqual(r.drafts[0].text, GOOD)
    assert.deepStrictEqual(r.drafts[0].openings, ['She will be asked to sit still for exactly one photo.', 'A dress for the wedding, in 2-8 years.'])
    assert.deepStrictEqual(r.drafts[0].notes, [])
    assert.strictEqual(r.costCents, 4) // two calls
  })

  test('a draft that fails is rewritten with the reasons, and a rewrite that passes carries no note', async () => {
    const ai = scripted([
      { posts: [mp('FACEBOOK_PAGE', 'Introducing our Linen Occasion Dress, a lovely piece for any occasion.\n\nMessage us to order.')] },
      { drafts: [fail('FACEBOOK_PAGE', 'READER', 'Open with the parent and the wedding.')] },
      { posts: [mp('FACEBOOK_PAGE', GOOD)] },
      { drafts: [pass('FACEBOOK_PAGE')] },
    ])
    const r = await draftPosts({ product: product(), channels: ['FACEBOOK_PAGE'], plan: plan() }, { client: ai.client })
    assert.strictEqual(ai.calls.length, 4)
    assert.match(ai.calls[2].prompt, /REWRITE\. Your earlier drafts for these channels did not pass the check/)
    assert.match(ai.calls[2].prompt, /FACEBOOK_PAGE: The first line opens with "introducing".*Open with the parent and the wedding\./)
    assert.match(ai.calls[2].prompt, /Earlier draft: """Introducing our Linen Occasion Dress/)
    assert.strictEqual(r.drafts[0].text, GOOD)
    assert.deepStrictEqual(r.drafts[0].notes, [])
  })

  test('only the channels that failed are rewritten', async () => {
    const ai = scripted([
      { posts: [mp('FACEBOOK_PAGE', GOOD), mp('TELEGRAM', `${GOOD} Hurry!`)] },
      { drafts: [pass('FACEBOOK_PAGE'), pass('TELEGRAM')] },
      { posts: [mp('TELEGRAM', GOOD)] },
      { drafts: [pass('TELEGRAM')] },
    ])
    const r = await draftPosts({ product: product(), channels: ['FACEBOOK_PAGE', 'TELEGRAM'], plan: plan() }, { client: ai.client })
    const channelsAsked = ai.calls[2].prompt.split('Channels to write:')[1]
    assert.ok(channelsAsked.includes('TELEGRAM (') && !channelsAsked.includes('FACEBOOK_PAGE ('))
    assert.deepStrictEqual(r.drafts.map((d) => d.channel), ['FACEBOOK_PAGE', 'TELEGRAM'])
    assert.deepStrictEqual(r.failures, [])
  })

  test('still weak after the rewrite: the owner sees it, with a note saying what is weak', async () => {
    const ai = scripted([
      { posts: [mp('FACEBOOK_PAGE', GOOD)] },
      { drafts: [fail('FACEBOOK_PAGE', 'SPECIFIC', 'Name the lining.')] },
      { posts: [mp('FACEBOOK_PAGE', `${GOOD}\n`)] },
      { drafts: [fail('FACEBOOK_PAGE', 'SPECIFIC', 'Still vague about the lining.')] },
    ])
    const r = await draftPosts({ product: product(), channels: ['FACEBOOK_PAGE'], plan: plan() }, { client: ai.client })
    assert.deepStrictEqual(r.drafts[0].notes, ['Still vague about the lining.'])
    assert.deepStrictEqual(r.failures, [])
  })

  test('invented urgency or an invented figure that survives the rewrite is thrown away, never shown', async () => {
    const ai = scripted([
      { posts: [mp('FACEBOOK_PAGE', `${GOOD} Hurry, selling fast!`), mp('TELEGRAM', `${GOOD} Loved by 200 families.`)] },
      { drafts: [pass('FACEBOOK_PAGE'), pass('TELEGRAM')] },
      { posts: [mp('FACEBOOK_PAGE', `${GOOD} Last chance!`), mp('TELEGRAM', `${GOOD} Loved by 300 families.`)] },
      { drafts: [pass('FACEBOOK_PAGE'), pass('TELEGRAM')] },
    ])
    const r = await draftPosts({ product: product(), channels: ['FACEBOOK_PAGE', 'TELEGRAM'], plan: plan() }, { client: ai.client })
    assert.deepStrictEqual(r.drafts, [])
    assert.match(r.failures[0].reason, /does not back.*urgency/)
    assert.match(r.failures[1].reason, /does not back.*300/)
  })

  test('the true reason from the brief may be used, and is in the prompt word for word', async () => {
    const text = `${GOOD.replace('Message us to order hers.', 'Only 2 left in stock.\n\nMessage us to order hers.')}`
    const ai = scripted([{ posts: [mp('FACEBOOK_PAGE', text)] }, { drafts: [pass('FACEBOOK_PAGE')] }])
    const r = await draftPosts({ product: product(), channels: ['FACEBOOK_PAGE'], plan: plan({ urgency: 'Only 2 left in stock.' }) }, { client: ai.client })
    assert.match(ai.calls[0].prompt, /Reason to act now: Only 2 left in stock\./)
    assert.strictEqual(r.drafts.length, 1)
  })

  test('the check never blocks writing: when it cannot answer, the draft goes through; check:false skips it', async () => {
    const broken = scripted([{ posts: [mp('FACEBOOK_PAGE', GOOD)] }, { nonsense: true }])
    const r = await draftPosts({ product: product(), channels: ['FACEBOOK_PAGE'], plan: plan() }, { client: broken.client })
    assert.strictEqual(r.drafts[0].text, GOOD)
    const off = scripted([{ posts: [mp('FACEBOOK_PAGE', GOOD)] }])
    await draftPosts({ product: product(), channels: ['FACEBOOK_PAGE'], plan: plan(), check: false }, { client: off.client })
    assert.strictEqual(off.calls.length, 1)
  })

  test('a made-up price is still refused outright and is not worth a rewrite', async () => {
    const ai = scripted([{ posts: [mp('FACEBOOK_PAGE', 'The dress for the wedding, only $39 today. Message us to order.')] }])
    const r = await draftPosts({ product: product(), channels: ['FACEBOOK_PAGE'], plan: plan() }, { client: ai.client })
    assert.strictEqual(ai.calls.length, 1)
    assert.match(r.failures[0].reason, /own price/)
  })
})

describe('the selling profile', () => {
  test('junk, money and half-filled rows are dropped; "ASK THE OWNER" becomes an unanswered doubt', () => {
    const p = cleanProfile({
      buyers: [{ who: ' A parent ', moment: 'a wedding in three weeks' }, { who: 'No moment' }, 'junk'],
      reasons: [{ reason: 'She can play all day', fact: 'Cotton lining' }, { reason: 'It costs only $20', fact: 'Price' }, { reason: 'No fact', fact: '' }],
      doubts: [{ doubt: 'Will it fit?', answer: 'ASK THE OWNER' }, { doubt: 'Is linen scratchy?', answer: 'No, it is lined in cotton.' }, { answer: 'no doubt' }],
      occasions: ['Weddings', 'Weddings', 7, ' Birthdays '],
    })
    assert.deepStrictEqual(p.buyers, [{ who: 'A parent', moment: 'a wedding in three weeks' }])
    assert.deepStrictEqual(p.reasons, [{ reason: 'She can play all day', fact: 'Cotton lining' }])
    assert.deepStrictEqual(p.doubts, [{ doubt: 'Will it fit?', answer: null }, { doubt: 'Is linen scratchy?', answer: 'No, it is lined in cotton.' }])
    assert.deepStrictEqual(p.occasions, ['Weddings', 'Birthdays'])
    assert.deepStrictEqual(cleanProfile(null), { buyers: [], reasons: [], doubts: [], occasions: [] })
    assert.strictEqual(buyerLine(p.buyers[0]), 'A parent, a wedding in three weeks')
    assert.strictEqual(doubtLine(p.doubts[0]), null)
    assert.match(String(doubtLine(p.doubts[1])), /^Answer the doubt "Is linen scratchy\?": No/)
  })

  test('the prompt gives only facts and policies, says when no policies are on file, and never the price', () => {
    const input = { product: { ...product(), category: 'Dresses' }, shop: shopIdentity(null) }
    const none = profileUserText(input)
    assert.match(none, /- Category: Dresses/)
    assert.match(none, /Sizes on file: yes/)
    assert.match(none, /No shop policies are on file\./)
    assert.ok(!none.includes('45') && !none.includes('2-8 years'))
    assert.match(profileUserText({ ...input, policies: { delivery: 'Harare in two days', returns: null } }), /Shop policies on file:\n- Delivery: Harare in two days/)
    const s = profileSystem(shopIdentity(null), 'English')
    assert.match(s, /write ASK THE OWNER and do not guess/)
    assert.match(s, /Never invent a fact, a customer, a review, a number or a policy/)
  })

  test('the AI answer is cleaned, and an empty profile is an error rather than a blank save', async () => {
    const good = scripted([{ buyers: [{ who: 'A parent', moment: 'a wedding soon' }], reasons: [{ reason: 'Plays all day', fact: 'Cotton lining' }], doubts: [{ doubt: 'Will it fit?', answer: 'ASK THE OWNER' }], occasions: ['Weddings'] }])
    const r = await writeProfile({ product: product(), shop: shopIdentity(null) }, { client: good.client })
    assert.strictEqual(r.profile.doubts[0].answer, null)
    assert.strictEqual(r.costCents, 2)
    const empty = scripted([{ buyers: [], reasons: [], doubts: [], occasions: [] }])
    await assert.rejects(writeProfile({ product: product(), shop: shopIdentity(null) }, { client: empty.client }), /could not work out/)
  })
})

describe('what the owner sees', () => {
  test('swapping the opening replaces only the first line, or the first sentence of a one-paragraph post', () => {
    assert.strictEqual(swapOpening('First line.\n\nSecond paragraph.', 'A new start.'), 'A new start.\n\nSecond paragraph.')
    assert.strictEqual(swapOpening('First sentence. Second sentence. Third.', 'A new start.'), 'A new start. Second sentence. Third.')
    assert.strictEqual(swapOpening('Just one sentence', 'A new start.'), 'A new start.')
    assert.strictEqual(swapOpening('Keep me.', '  '), 'Keep me.')
  })

  test('the summary says when a draft could be stronger and passes on warnings', () => {
    const s = draftSummary({ posts: [{ id: 1, aiNotes: ['Vague.'] }, { id: 2, aiNotes: [] }], failed: [], costCents: 3, warnings: ['The reason is no longer true.'] })
    assert.match(s.message, /One could be stronger: see the note on the post\./)
    assert.deepStrictEqual(s.warnings, ['The reason is no longer true.'])
    assert.doesNotMatch(draftSummary({ posts: [{ id: 1 }], failed: [], costCents: 0 }).message, /stronger/)
  })
})
