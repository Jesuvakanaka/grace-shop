// ZP-1200: the AI post writer with fake Claude / OpenAI clients. No network.
import { describe, test } from 'node:test'
import assert from 'node:assert'
import Anthropic from '@anthropic-ai/sdk'
import { assemblePost, channelRules, draftPosts, fillPlaceholders, parseModelOutput, type DraftProduct } from '../src/lib/marketing/ai/writer'
import { getChannel } from '../src/lib/marketing/channels'

const product = (extra: Partial<DraftProduct> = {}): DraftProduct => ({
  productName: 'ZP1200 Pink Dress',
  publicName: 'Pink Party Dress',
  publicDescription: 'A soft pink dress with three bows.',
  colours: 'Pink',
  sizes: '4-8 years',
  sellingPriceUsd: 45,
  priceDisplay: 'SHOW_PRICE',
  ...extra,
})

const mp = (channel: string, text: string, extra: Record<string, unknown> = {}) => ({ channel, text, headline: null, description: null, subject: null, hashtags: [], openings: [] as string[], ...extra })

function fakeClaude(posts: unknown[], calls: { args?: Record<string, unknown> } = {}, usage = { input_tokens: 1000, output_tokens: 500 }) {
  return {
    messages: {
      create: async (args: Record<string, unknown>) => {
        calls.args = args
        return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ posts }) }], usage }
      },
    },
  } as unknown as Pick<Anthropic, 'messages'>
}
const claudeDown = () =>
  ({ messages: { create: async () => { throw new Anthropic.APIError(402, {}, 'out of credit', new Headers()) } } }) as unknown as Pick<Anthropic, 'messages'>
const fakeOpenAI = (posts: unknown[], calls: { n: number } = { n: 0 }) =>
  ({
    responses: {
      create: async () => {
        calls.n++
        return { output: [], output_text: JSON.stringify({ posts }), usage: { input_tokens: 1000, output_tokens: 500 } }
      },
    },
  }) as never

const LINK = 'https://vyra.example/p/pink?src=mkabc123def456'

describe('placeholders are filled by code from the product', () => {
  test('price and sizes come from the Product row', () => {
    assert.strictEqual(fillPlaceholders('Only {price} in {sizes}.', product()), 'Only $45 in 4-8 years.')
    assert.strictEqual(fillPlaceholders('From {price}.', product({ sellingPriceUsd: 45.5 })), 'From $45.50.')
  })

  test('price hidden when priceDisplay says ASK_FOR_PRICE, or the price is 0', () => {
    for (const p of [product({ priceDisplay: 'ASK_FOR_PRICE' }), product({ sellingPriceUsd: 0 })]) {
      const t = fillPlaceholders('A lovely dress. Yours for {price}. Message us to order.', p)
      assert.ok(!t.includes('$') && !t.includes('{') && !/Yours for/.test(t), t)
      assert.match(t, /A lovely dress\. Message us to order\./)
    }
  })

  test('no sizes on file drops the sizes sentence', () => {
    const t = fillPlaceholders('Pretty bows. Available in {sizes}.', product({ sizes: null }))
    assert.strictEqual(t, 'Pretty bows.')
  })

  test('the prompt tells the model when the price is hidden and never contains it', async () => {
    const calls: { args?: Record<string, unknown> } = {}
    await draftPosts(
      { product: product({ priceDisplay: 'ASK_FOR_PRICE', sellingPriceUsd: 99.99 }), channels: ['FACEBOOK_PAGE'] },
      { client: fakeClaude([mp('FACEBOOK_PAGE', 'Lovely dress. {link}')], calls) },
    )
    const body = JSON.stringify(calls.args)
    assert.match(body, /NOT public/)
    assert.ok(!body.includes('99.99'))
    assert.match(body, /British spelling/)
    assert.match(String(calls.args?.system), /Never invent a price, size, stock level/)
  })

  test('the link is added by code, once, even if the model placed {link} inside the text', async () => {
    const r = await draftPosts(
      { product: product(), channels: ['FACEBOOK_PAGE'], links: { FACEBOOK_PAGE: LINK } },
      { client: fakeClaude([mp('FACEBOOK_PAGE', 'See it here {link} and fall in love with the bows.')]) },
    )
    assert.strictEqual(r.drafts[0].text, `See it here and fall in love with the bows.\n\n${LINK}`)
    assert.strictEqual(r.drafts[0].text.split(LINK).length - 1, 1)
  })
})

describe('channel rules', () => {
  test('Instagram gets hashtags capped at 8; no hashtags where the channel has none', () => {
    const tags = Array.from({ length: 12 }, (_, i) => `#tag${i}`)
    const ig = assemblePost(mp('INSTAGRAM', 'Pretty in pink, always.', { hashtags: tags }), getChannel('INSTAGRAM')!, product(), LINK)
    assert.ok('text' in ig)
    if ('text' in ig) {
      assert.strictEqual((ig.text.match(/#tag/g) ?? []).length, 8)
      assert.ok(ig.text.endsWith('#tag7'))
    }
    const em = assemblePost(mp('FACEBOOK_GROUPS', 'Pretty in pink, always.', { hashtags: ['x'] }), getChannel('FACEBOOK_GROUPS')!, product(), null)
    assert.ok('text' in em && !em.text.includes('#'))
  })

  test('SMS stays within 160 characters including the link (body is trimmed at a word)', () => {
    const long = 'A beautiful soft pink party dress with three satin bows, perfect for birthdays and weddings and every special occasion this season. '.repeat(2)
    const r = assemblePost(mp('SMS', long), getChannel('SMS')!, product(), LINK)
    assert.ok('text' in r)
    if ('text' in r) {
      assert.ok(r.text.length <= 160, String(r.text.length))
      assert.ok(r.text.endsWith(LINK))
      assert.match(r.text, /…\n\n/)
    }
    assert.ok('text' in r && r.cut === true)
    assert.strictEqual(channelRules(getChannel('SMS')!).maxText, 160)
    // The writer is told how many characters its words may take once the link is in.
    assert.strictEqual(channelRules(getChannel('SMS')!, LINK).words, 160 - LINK.length - 2)
    assert.match(channelRules(getChannel('SMS')!, LINK).lines, new RegExp(`your words at most ${160 - LINK.length - 2} characters`))
  })

  test('WhatsApp Status is very short', () => {
    assert.ok(channelRules(getChannel('WHATSAPP_STATUS')!).maxText <= 140)
    const r = assemblePost(mp('WHATSAPP_STATUS', 'New in: the pink party dress. '.repeat(20)), getChannel('WHATSAPP_STATUS')!, product(), null)
    assert.ok('text' in r && r.text.length <= 140)
    // The link does not eat into the 140 characters of words, and a post that fits is not marked as cut.
    assert.strictEqual(channelRules(getChannel('WHATSAPP_STATUS')!, LINK).words, 140)
    const fits = assemblePost(mp('WHATSAPP_STATUS', 'Linen outside, soft cotton against her skin. Message us to order.'), getChannel('WHATSAPP_STATUS')!, product(), LINK)
    assert.ok('text' in fits && !fits.cut && fits.text.endsWith(LINK))
  })

  test('ads carry headline, primary text and description; email carries a subject', () => {
    const ad = assemblePost(mp('META_ADS', 'Soft pink party dress.', { headline: 'New in pink', description: 'Message us to order' }), getChannel('META_ADS')!, product(), LINK)
    assert.ok('text' in ad)
    if ('text' in ad) assert.strictEqual(ad.text, `New in pink\n\nSoft pink party dress.\n\nMessage us to order\n\n${LINK}`)
    assert.ok('error' in assemblePost(mp('META_ADS', 'Soft pink party dress.'), getChannel('META_ADS')!, product(), LINK))
    const mail = assemblePost(mp('EMAIL', 'Hello, our new dress is here.', { subject: 'Pink has arrived' }), getChannel('EMAIL')!, product(), LINK)
    assert.ok('text' in mail && mail.text.startsWith('Subject: Pink has arrived\n\nHello'))
    assert.ok('error' in assemblePost(mp('EMAIL', 'Hello'), getChannel('EMAIL')!, product(), LINK))
  })

  test('text that cannot fit even after trimming is rejected, not cut off', () => {
    const r = assemblePost(mp('SMS', 'Short body here for the dress.'), getChannel('SMS')!, product(), 'https://x.example/' + 'a'.repeat(160))
    assert.ok('error' in r)
  })
})

describe('model output is validated', () => {
  test('wrong shape throws; rows without channel or text are ignored', () => {
    assert.throws(() => parseModelOutput({ nope: 1 }), /expected shape/)
    assert.throws(() => parseModelOutput(null), /expected shape/)
    assert.deepStrictEqual(parseModelOutput({ posts: [{ channel: 'X' }, 5, { channel: 'X', text: ' hi ' }] }).map((p) => p.text), ['hi'])
  })

  test('a made-up price, an unknown placeholder or an empty text fails that channel only', async () => {
    const r = await draftPosts(
      { product: product(), channels: ['FACEBOOK_PAGE', 'THREADS', 'TELEGRAM', 'X', 'PINTEREST'] },
      {
        client: fakeClaude([
          mp('FACEBOOK_PAGE', 'Only $39 today!'),
          mp('THREADS', 'Hello {colour} dress'),
          mp('TELEGRAM', 'A lovely dress for {price}.'),
          mp('X', '   '),
        ]),
      },
    )
    assert.deepStrictEqual(r.drafts.map((d) => d.channel), ['TELEGRAM'])
    assert.strictEqual(r.drafts[0].text, 'A lovely dress for $45.')
    const why = Object.fromEntries(r.failures.map((f) => [f.channel, f.reason]))
    assert.match(why.FACEBOOK_PAGE, /own price/)
    assert.match(why.THREADS, /placeholder/)
    assert.match(why.X, /no text/)
    assert.match(why.PINTEREST, /did not write/)
  })

  test('invalid JSON from the model throws', async () => {
    const client = { messages: { create: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }], usage: { input_tokens: 1, output_tokens: 1 } }) } } as never
    await assert.rejects(draftPosts({ product: product(), channels: ['X'] }, { client }), /not valid JSON/)
  })

  test('unknown or empty channel lists are refused', async () => {
    await assert.rejects(draftPosts({ product: product(), channels: ['NOPE'] }, { client: fakeClaude([]) }), /Unknown channel/)
    await assert.rejects(draftPosts({ product: product(), channels: [] }, { client: fakeClaude([]) }), /at least one/)
  })
})

describe('Claude first, OpenAI fallback, cost in cents', () => {
  test('Claude is used and its cost estimated ($4 / $20 per million tokens)', async () => {
    const r = await draftPosts({ product: product(), channels: ['X'] }, { client: fakeClaude([mp('X', 'Pink, please.')]) })
    assert.strictEqual(r.writer, 'claude')
    assert.strictEqual(r.costCents, 2) // 1000*0.0004 + 500*0.002 = 1.4 cents, rounded up
  })

  test('uses ANTHROPIC_MARKETING_MODEL, then ANTHROPIC_LISTING_MODEL', async () => {
    const saved = [process.env.ANTHROPIC_MARKETING_MODEL, process.env.ANTHROPIC_LISTING_MODEL]
    try {
      process.env.ANTHROPIC_LISTING_MODEL = 'listing-model'
      process.env.ANTHROPIC_MARKETING_MODEL = 'marketing-model'
      const calls: { args?: Record<string, unknown> } = {}
      await draftPosts({ product: product(), channels: ['X'] }, { client: fakeClaude([mp('X', 'Pink, please.')], calls) })
      assert.strictEqual(calls.args?.model, 'marketing-model')
      delete process.env.ANTHROPIC_MARKETING_MODEL
      await draftPosts({ product: product(), channels: ['X'] }, { client: fakeClaude([mp('X', 'Pink, please.')], calls) })
      assert.strictEqual(calls.args?.model, 'listing-model')
    } finally {
      for (const [k, v] of [['ANTHROPIC_MARKETING_MODEL', saved[0]], ['ANTHROPIC_LISTING_MODEL', saved[1]]] as const) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
  })

  test('falls back to OpenAI when the Claude call fails', async () => {
    const calls = { n: 0 }
    const r = await draftPosts({ product: product(), channels: ['X'] }, { client: claudeDown(), openai: fakeOpenAI([mp('X', 'Pink, please.')], calls) })
    assert.strictEqual(r.writer, 'openai')
    assert.strictEqual(calls.n, 1)
    assert.strictEqual(r.costCents, 3) // 1000*0.0008 + 500*0.004 = 2.8 cents, rounded up
  })

  test('without a Claude key OpenAI writes; with Claude failing and no OpenAI the error surfaces; no keys at all throws', async () => {
    const savedA = process.env.ANTHROPIC_API_KEY
    const savedO = process.env.OPENAI_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.OPENAI_API_KEY
    try {
      const r = await draftPosts({ product: product(), channels: ['X'] }, { openai: fakeOpenAI([mp('X', 'Pink, please.')]) })
      assert.strictEqual(r.writer, 'openai')
      await assert.rejects(draftPosts({ product: product(), channels: ['X'] }, { client: claudeDown() }), /402/)
      await assert.rejects(draftPosts({ product: product(), channels: ['X'] }), /No AI key/)
    } finally {
      if (savedA !== undefined) process.env.ANTHROPIC_API_KEY = savedA
      if (savedO !== undefined) process.env.OPENAI_API_KEY = savedO
    }
  })
})
