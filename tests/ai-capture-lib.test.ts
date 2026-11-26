import assert from 'node:assert/strict'
import { test } from 'node:test'
import Anthropic from '@anthropic-ai/sdk'
import { MASTER_PROMPT, buildPhotoPrompt, usesHouseModel } from '../src/lib/ai/master-prompt'
import { parseListingDraft } from '../src/lib/ai/listing'
import { generateFashionPhoto, photoCostCents } from '../src/lib/ai/openai-images'
import { writeListing } from '../src/lib/ai/listing-text'
import { aiStatus } from '../src/lib/ai/config'

test('buildPhotoPrompt per slot', () => {
  const p0 = buildPhotoPrompt({ slot: 0, details: ['3 satin bows'], hasFirstPhoto: false, hasHouseModel: false, audience: 'girls', notes: 'pink' })
  assert.ok(p0.startsWith(MASTER_PROMPT))
  assert.match(p0, /Make only Image 1 \(pose: Elegant standing/)
  assert.match(p0, /Details that must be kept exactly:\n\* 3 satin bows/)
  assert.match(p0, /girls/)
  assert.match(p0, /keep every label, patch or badge that is sewn onto the garment/)
  assert.doesNotMatch(p0, /LAST reference image|Image 1 of this set/)
  const p2 = buildPhotoPrompt({ slot: 2, details: [], hasFirstPhoto: true, hasHouseModel: true })
  assert.match(p2, /Make only Image 3 \(pose: Beautiful seated/)
  assert.match(p2, /next reference image is Image 1 of this set/)
  assert.match(p2, /LAST reference image shows the VYRA house model/)
  assert.doesNotMatch(p2, /Details that must/)
})

test('usesHouseModel: women and unisex yes, children and men no', () => {
  for (const a of [null, '', 'women', 'Ladies', 'unisex', 'women 30s']) assert.equal(usesHouseModel(a), true, String(a))
  for (const a of ['girls 4-8', 'boys', 'kids', 'children', 'baby', 'men', "Men's"]) assert.equal(usesHouseModel(a), false, a)
})

test('parseListingDraft enforces limits', () => {
  const d = parseListingDraft(
    {
      publicName: ' ' + 'a'.repeat(300),
      description: 'd'.repeat(5000),
      categoryId: 99,
      colours: '  ',
      sizes: 's'.repeat(500),
      altText: 'x'.repeat(500),
      details: Array.from({ length: 20 }, (_, i) => `d${i}`).concat(['', 5 as unknown as string]),
    },
    [1, 2],
  )
  assert.equal(d.publicName.length, 120)
  assert.equal(d.description.length, 2000)
  assert.equal(d.categoryId, null)
  assert.equal(d.colours, null)
  assert.equal(d.sizes?.length, 200)
  assert.equal(d.altText.length, 200)
  assert.equal(d.details.length, 12)
  assert.equal(parseListingDraft({ categoryId: 2 }, [1, 2]).categoryId, 2)
  assert.equal(parseListingDraft(null, []).publicName, '')
})

test('generateFashionPhoto uses Astra with the image tool and real usage', async () => {
  type CreateArgs = {
    model: string
    input: { content: { type: string; image_url?: string }[] }[]
    tools: { type: string; quality: string; size: string }[]
  }
  type PhotoClient = NonNullable<Parameters<typeof generateFashionPhoto>[0]['client']>
  let args = {} as CreateArgs
  const usage = { input_tokens: 10_000, output_tokens: 100, input_tokens_details: { cached_tokens: 0 } }
  const toolUsage = { input_tokens: 4500, output_tokens: 1132, input_tokens_details: { text_tokens: 500, image_tokens: 4000 } }
  const client = {
    responses: {
      create: async (a: unknown) => {
        args = a as CreateArgs
        return {
          output: [{ type: 'image_generation_call', result: Buffer.from('png!').toString('base64') }],
          usage,
          tool_usage: { image_gen: toolUsage },
        }
      },
    },
  } as unknown as PhotoClient
  const webp = Buffer.from('RIFF0000WEBPVP8 ', 'latin1')
  const r = await generateFashionPhoto({ references: [webp, Buffer.from('b')], prompt: 'p', client })
  assert.equal(r.png.toString(), 'png!')
  assert.equal(args.model, 'gpt-6.2-astra')
  assert.equal(args.tools[0].type, 'image_generation')
  assert.equal(args.tools[0].size, '1024x1536')
  assert.equal(args.tools[0].quality, 'medium')
  assert.equal(args.input[0].content.filter((c) => c.type === 'input_image').length, 2)
  assert.ok(args.input[0].content[0].image_url?.startsWith('data:image/webp;base64,'))
  // 10000*8 + 100*40 = 84000 -> $0.084; 500*5 + 4000*8 + 1132*30 = 68460 -> $0.06846; total 15.2 cents -> 16
  assert.equal(photoCostCents(usage, toolUsage), 15.2)
  assert.equal(r.costCents, 16)
  const none = { responses: { create: async () => ({ output: [{ type: 'message' }] }) } } as unknown as PhotoClient
  await assert.rejects(generateFashionPhoto({ references: [], prompt: 'p', client: none }), /no picture/)
})

const LISTING_JSON = JSON.stringify({ publicName: 'Rose Dress', description: 'Lovely', categoryId: 7, details: ['bow'] })

test('writeListing with Claude', async () => {
  type CreateArgs = {
    output_config: { effort: string; format: { type: string } }
    messages: { content: { type: string }[] }[]
  }
  type TextClient = NonNullable<Parameters<typeof writeListing>[0]['client']>
  let args = {} as CreateArgs
  const reply = (stop_reason: string) => ({
    stop_reason,
    content: [{ type: 'text', text: LISTING_JSON }],
    usage: { input_tokens: 1000, output_tokens: 500 },
  })
  const client = { messages: { create: async (a: unknown) => ((args = a as CreateArgs), reply('end_turn')) } } as unknown as TextClient
  const r = await writeListing({
    references: [Buffer.from('x')],
    categories: [{ id: 7, name: 'Dresses' }],
    listingType: 'PRE_ORDER',
    client,
  })
  assert.equal(r.writer, 'claude')
  assert.equal(r.listing.publicName, 'Rose Dress')
  assert.equal(r.listing.categoryId, 7)
  assert.deepEqual(r.listing.details, ['bow'])
  assert.equal(r.costCents, 2) // ceil(0.4 + 1.0)
  assert.equal(args.output_config.effort, 'low')
  assert.equal(args.output_config.format.type, 'json_schema')
  assert.equal(args.messages[0].content[0].type, 'image')
  const refuse = { messages: { create: async () => reply('refusal') } } as unknown as TextClient
  await assert.rejects(
    writeListing({ references: [], categories: [], listingType: 'IN_STOCK', client: refuse }),
    /declined/,
  )
})

test('writeListing falls back to OpenAI when Claude fails, and uses it when there is no Claude key', async () => {
  type TextClient = NonNullable<Parameters<typeof writeListing>[0]['client']>
  type OpenAIClient = NonNullable<Parameters<typeof writeListing>[0]['openai']>
  type ResponsesArgs = { model: string; text: { format: { type: string; strict: boolean } }; input: { content: { type: string }[] }[] }
  let args = {} as ResponsesArgs
  const openai = {
    responses: {
      create: async (a: unknown) => {
        args = a as ResponsesArgs
        return { output: [{ type: 'message', content: [{ type: 'output_text' }] }], output_text: LISTING_JSON, usage: { input_tokens: 8000, output_tokens: 1000 } }
      },
    },
  } as unknown as OpenAIClient
  const outOfCredit = {
    messages: {
      create: async () => {
        throw new Anthropic.BadRequestError(400, { error: { message: 'Your credit balance is too low' } }, 'credit balance is too low', new Headers())
      },
    },
  } as unknown as TextClient
  const input = { references: [Buffer.from('x')], categories: [{ id: 7, name: 'Dresses' }], listingType: 'IN_STOCK' as const }
  const warn = console.warn
  console.warn = () => {}
  try {
    const r = await writeListing({ ...input, client: outOfCredit, openai })
    assert.equal(r.writer, 'openai')
    assert.equal(r.listing.publicName, 'Rose Dress')
    assert.equal(r.costCents, 2) // ceil(8000*0.000125 + 1000*0.001) = ceil(2.0)
    assert.equal(args.model, 'gpt-5.1')
    assert.equal(args.text.format.type, 'json_schema')
    assert.equal(args.text.format.strict, true)
    assert.equal(args.input[0].content[0].type, 'input_image')
  } finally {
    console.warn = warn
  }
  const saved = process.env.ANTHROPIC_API_KEY
  delete process.env.ANTHROPIC_API_KEY
  try {
    assert.equal((await writeListing({ ...input, openai })).writer, 'openai')
  } finally {
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved
  }
})

test('aiStatus reads env', () => {
  const o = { ...process.env }
  process.env.OPENAI_API_KEY = 'k'
  delete process.env.ANTHROPIC_API_KEY
  assert.deepEqual(aiStatus(), { photos: true, text: true })
  delete process.env.OPENAI_API_KEY
  assert.deepEqual(aiStatus(), { photos: false, text: false })
  process.env = o
})
