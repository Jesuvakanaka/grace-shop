// Claude listing writer. Server-only.
import Anthropic from '@anthropic-ai/sdk'
import { parseListingDraft, type ListingDraft } from './listing'

// Estimated pricing: $4 per million input tokens, $20 per million output tokens.
const INPUT_CENTS_PER_TOKEN = 400 / 1_000_000
const OUTPUT_CENTS_PER_TOKEN = 2000 / 1_000_000

const SYSTEM = `You are the copywriter for VYRA, a luxury boutique. Write warm, elegant product listings in British spelling.
Look at the garment photos and describe only what you can see.
Never invent fabric content you cannot see: use hedges such as "soft woven fabric" instead of naming a fibre.
Never mention price.
"details" are small visual details (bows, buttons, embroidery, trims) that a photo editor must preserve exactly, each a short phrase.
Choose categoryId only from the categories given, or null if none fits.`

const SCHEMA = {
  type: 'object',
  properties: {
    publicName: { type: 'string' },
    description: { type: 'string' },
    categoryId: { type: ['integer', 'null'] },
    colours: { type: ['string', 'null'] },
    sizes: { type: ['string', 'null'] },
    fabric: { type: ['string', 'null'] },
    care: { type: ['string', 'null'] },
    altText: { type: 'string' },
    details: { type: 'array', items: { type: 'string' } },
  },
  required: ['publicName', 'description', 'categoryId', 'colours', 'sizes', 'fabric', 'care', 'altText', 'details'],
  additionalProperties: false,
}

export async function writeListing(opts: {
  references: Buffer[]
  categories: { id: number; name: string }[]
  audience?: string | null
  notes?: string | null
  listingType: 'IN_STOCK' | 'PRE_ORDER'
  client?: Pick<Anthropic, 'messages'>
}): Promise<{ listing: ListingDraft; costCents: number }> {
  const client = opts.client ?? new Anthropic()
  const lines = [
    `Listing type: ${opts.listingType === 'PRE_ORDER' ? 'pre-order (ships in a few months)' : 'in stock'}.`,
    `Categories: ${opts.categories.map((c) => `${c.id} = ${c.name}`).join('; ') || 'none'}.`,
  ]
  if (opts.audience?.trim()) lines.push(`Audience: ${opts.audience.trim()}.`)
  if (opts.notes?.trim()) lines.push(`Owner's note: ${opts.notes.trim()}`)
  lines.push('Write the listing as JSON.')

  const msg = await client.messages.create({
    model: process.env.ANTHROPIC_LISTING_MODEL || 'claude-opus-5-5',
    max_tokens: 4000,
    system: SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [
      {
        role: 'user',
        content: [
          ...opts.references.map((buf) => ({
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: 'image/webp' as const, data: buf.toString('base64') },
          })),
          { type: 'text' as const, text: lines.join('\n') },
        ],
      },
    ],
  })
  if (msg.stop_reason === 'refusal') throw new Error('The AI declined to write a listing for this photo')
  const block = msg.content.find((b) => b.type === 'text')
  if (!block || block.type !== 'text') throw new Error('The AI returned no listing text')
  let json: unknown
  try {
    json = JSON.parse(block.text)
  } catch {
    throw new Error('The AI listing was not valid JSON')
  }
  const listing = parseListingDraft(json, opts.categories.map((c) => c.id))
  const costCents = Math.ceil(
    msg.usage.input_tokens * INPUT_CENTS_PER_TOKEN + msg.usage.output_tokens * OUTPUT_CENTS_PER_TOKEN,
  )
  return { listing, costCents }
}
