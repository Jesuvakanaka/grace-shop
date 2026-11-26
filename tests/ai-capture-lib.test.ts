import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MASTER_PROMPT, buildPhotoPrompt } from '../src/lib/ai/master-prompt'
import { parseListingDraft } from '../src/lib/ai/listing'
import { generateFashionPhoto } from '../src/lib/ai/openai-images'
import { writeListing } from '../src/lib/ai/listing-text'
import { aiStatus } from '../src/lib/ai/config'

test('buildPhotoPrompt per slot', () => {
  const p0 = buildPhotoPrompt({ slot: 0, details: ['3 satin bows'], hasModelReference: false, audience: 'girls', notes: 'pink' })
  assert.ok(p0.startsWith(MASTER_PROMPT))
  assert.match(p0, /Make only Image 1 \(pose: Elegant standing/)
  assert.match(p0, /Details that must be kept exactly: 3 satin bows/)
  assert.match(p0, /girls/)
  assert.doesNotMatch(p0, /LAST reference image/)
  const p2 = buildPhotoPrompt({ slot: 2, details: [], hasModelReference: true })
  assert.match(p2, /Make only Image 3 \(pose: Beautiful seated/)
  assert.match(p2, /LAST reference image shows the model/)
  assert.doesNotMatch(p2, /Details that must/)
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

test('generateFashionPhoto with fake client', async () => {
  type EditArgs = { size?: string; image?: unknown[] }
  let args: EditArgs = {}
  type PhotoClient = NonNullable<Parameters<typeof generateFashionPhoto>[0]['client']>
  const client = {
    images: {
      edit: async (a: unknown) => {
        args = a as EditArgs
        return { data: [{ b64_json: Buffer.from('png!').toString('base64') }] }
      },
    },
  } as unknown as PhotoClient
  const r = await generateFashionPhoto({ references: [Buffer.from('a'), Buffer.from('b')], prompt: 'p', client })
  assert.equal(r.png.toString(), 'png!')
  assert.equal(args.size, '1024x1536')
  assert.equal(args.image?.length, 2)
  assert.ok(r.costCents > 0)
  const bad = { images: { edit: async () => ({ data: [] }) } } as unknown as PhotoClient
  await assert.rejects(generateFashionPhoto({ references: [], prompt: 'p', client: bad }))
})

test('writeListing with fake client', async () => {
  type CreateArgs = {
    output_config: { effort: string; format: { type: string } }
    messages: { content: { type: string }[] }[]
  }
  type TextClient = NonNullable<Parameters<typeof writeListing>[0]['client']>
  let args = {} as CreateArgs
  const reply = (stop_reason: string) => ({
    stop_reason,
    content: [{ type: 'text', text: JSON.stringify({ publicName: 'Rose Dress', description: 'Lovely', categoryId: 7, details: ['bow'] }) }],
    usage: { input_tokens: 1000, output_tokens: 500 },
  })
  const client = { messages: { create: async (a: unknown) => ((args = a as CreateArgs), reply('end_turn')) } } as unknown as TextClient
  const r = await writeListing({
    references: [Buffer.from('x')],
    categories: [{ id: 7, name: 'Dresses' }],
    listingType: 'PRE_ORDER',
    client,
  })
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

test('aiStatus reads env', () => {
  const o = { ...process.env }
  process.env.OPENAI_API_KEY = 'k'
  delete process.env.ANTHROPIC_API_KEY
  assert.deepEqual(aiStatus(), { photos: true, text: false })
  process.env = o
})
