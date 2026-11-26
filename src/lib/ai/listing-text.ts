// Listing writer: Claude, or OpenAI when there is no Claude key or the Claude
// call fails (for example out of credit). Server-only.
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { sniffImageType } from '@/lib/storage/images'
import { parseListingDraft, type ListingDraft } from './listing'

// Estimated pricing in cents per token. Claude: $4 / $20 per million input / output.
const CLAUDE = { input: 400 / 1_000_000, output: 2000 / 1_000_000 }
// OpenAI fallback (developers.openai.com/api/docs/pricing, 2026-11-26): $1.25 / $10 per million.
export const OPENAI_LISTING_MODEL = 'gpt-5.1'
const GPT = { input: 125 / 1_000_000, output: 1000 / 1_000_000 }

const SYSTEM = `You are the copywriter for VYRA, a luxury boutique. Write warm, elegant product listings in British spelling.
Look at the garment photos and describe only what you can see.
Never invent fabric content you cannot see: use hedges such as "soft woven fabric" instead of naming a fibre.
Never mention price.
"details" is the checklist a photo editor uses to reproduce the garment exactly on a model. Up to 12 items, each one clear sentence:
- First: the length and how it is worn (for example "Knee-length: the hem falls at the knee, worn over a plain black T-shirt as in the photo"). If the photo is lying flat or turned sideways, say so.
- Then every distinctive detail with where it sits: pockets, flaps, buttons, clasps, straps, seams, contrast stitching, bows, embroidery, prints, trims, sewn-on labels or patches.
- When similar parts differ (for example two different pockets), say they are different and describe each one.
- Last: what is NOT there that an editor might wrongly add (for example "No chest pocket and no waist seam").
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

type ListingInput = {
  references: Buffer[]
  categories: { id: number; name: string }[]
  audience?: string | null
  notes?: string | null
  listingType: 'IN_STOCK' | 'PRE_ORDER'
}
type ListingResult = { listing: ListingDraft; costCents: number; writer: 'claude' | 'openai' }

const mimeOf = (buf: Buffer) => sniffImageType(buf) ?? 'image/webp'

function userText(opts: ListingInput): string {
  const lines = [
    `Listing type: ${opts.listingType === 'PRE_ORDER' ? 'pre-order (ships in a few months)' : 'in stock'}.`,
    `Categories: ${opts.categories.map((c) => `${c.id} = ${c.name}`).join('; ') || 'none'}.`,
  ]
  if (opts.audience?.trim()) lines.push(`Audience: ${opts.audience.trim()}.`)
  if (opts.notes?.trim()) lines.push(`Owner's note: ${opts.notes.trim()}`)
  lines.push('Write the listing as JSON.')
  return lines.join('\n')
}

function parseJson(text: string, opts: ListingInput): ListingDraft {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('The AI listing was not valid JSON')
  }
  return parseListingDraft(json, opts.categories.map((c) => c.id))
}

/**
 * Write the listing with Claude when its key is set, falling back to OpenAI
 * when there is no Claude key or the Claude call fails.
 */
export async function writeListing(
  opts: ListingInput & { client?: Pick<Anthropic, 'messages'>; openai?: Pick<OpenAI, 'responses'> },
): Promise<ListingResult> {
  const hasClaude = Boolean(opts.client || process.env.ANTHROPIC_API_KEY)
  const hasOpenAI = Boolean(opts.openai || process.env.OPENAI_API_KEY)
  if (!hasClaude && !hasOpenAI) throw new Error('No AI key is set up for the listing text')
  if (hasClaude) {
    try {
      return await writeWithClaude(opts, opts.client ?? new Anthropic())
    } catch (error) {
      // A refusal is about the photo, so OpenAI would not help.
      if (!hasOpenAI || !(error instanceof Anthropic.APIError)) throw error
      console.warn('[capture] Claude listing failed, using OpenAI:', error.status, error.message)
    }
  }
  return writeWithOpenAI(opts, opts.openai ?? new OpenAI({ maxRetries: 2 }))
}

async function writeWithClaude(opts: ListingInput, client: Pick<Anthropic, 'messages'>): Promise<ListingResult> {
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
            source: {
              type: 'base64' as const,
              media_type: mimeOf(buf) as 'image/webp' | 'image/png' | 'image/jpeg',
              data: buf.toString('base64'),
            },
          })),
          { type: 'text' as const, text: userText(opts) },
        ],
      },
    ],
  })
  if (msg.stop_reason === 'refusal') throw new Error('The AI declined to write a listing for this photo')
  const block = msg.content.find((b) => b.type === 'text')
  if (!block || block.type !== 'text') throw new Error('The AI returned no listing text')
  const costCents = Math.ceil(msg.usage.input_tokens * CLAUDE.input + msg.usage.output_tokens * CLAUDE.output)
  return { listing: parseJson(block.text, opts), costCents, writer: 'claude' }
}

async function writeWithOpenAI(opts: ListingInput, client: Pick<OpenAI, 'responses'>): Promise<ListingResult> {
  const res = await client.responses.create({
    model: OPENAI_LISTING_MODEL,
    instructions: SYSTEM,
    reasoning: { effort: 'low' },
    input: [
      {
        role: 'user',
        content: [
          ...opts.references.map((buf) => ({
            type: 'input_image' as const,
            image_url: `data:${mimeOf(buf)};base64,${buf.toString('base64')}`,
            detail: 'high' as const,
          })),
          { type: 'input_text' as const, text: userText(opts) },
        ],
      },
    ],
    text: { format: { type: 'json_schema', name: 'listing', schema: SCHEMA, strict: true } },
  })
  const refused = res.output.some((o) => o.type === 'message' && o.content.some((c) => c.type === 'refusal'))
  if (refused) throw new Error('The AI declined to write a listing for this photo')
  if (!res.output_text) throw new Error('The AI returned no listing text')
  const u = res.usage
  const costCents = Math.ceil((u?.input_tokens ?? 0) * GPT.input + (u?.output_tokens ?? 0) * GPT.output)
  return { listing: parseJson(res.output_text, opts), costCents, writer: 'openai' }
}
