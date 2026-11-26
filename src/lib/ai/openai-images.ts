// Model photos through gpt-6.2-astra and its image generation tool (the same
// route ChatGPT uses). Server-only. Chosen after the denim pinafore tests: it
// was the only model that kept every garment detail.
import OpenAI from 'openai'
import { sniffImageType } from '@/lib/storage/images'

export const PHOTO_MODEL = 'gpt-6.2-astra'
export const PHOTO_SIZE = '1024x1536'

// USD per 1M tokens (developers.openai.com/api/docs/pricing, 2026-11-26).
const ASTRA = { input: 8, cached: 0.4, output: 40 }
const IMAGE_TOOL = { text: 5, image: 8, output: 30 }
// Used only if OpenAI reports no usage (about what a medium photo cost in the tests).
const FALLBACK_CENTS = 16

type Quality = 'low' | 'medium' | 'high'

export function photoQuality(): Quality {
  const q = process.env.OPENAI_IMAGE_QUALITY
  return q === 'low' || q === 'high' ? q : 'medium'
}

type Usage = {
  input_tokens?: number
  output_tokens?: number
  input_tokens_details?: { cached_tokens?: number; text_tokens?: number; image_tokens?: number } | null
} | null | undefined

/** Cost in US cents from the usage OpenAI reports, or null when it reports none. */
export function photoCostCents(usage: Usage, toolUsage: Usage): number | null {
  if (!usage && !toolUsage) return null
  let usd = 0
  if (usage) {
    const cached = usage.input_tokens_details?.cached_tokens ?? 0
    usd += (((usage.input_tokens ?? 0) - cached) * ASTRA.input + cached * ASTRA.cached + (usage.output_tokens ?? 0) * ASTRA.output) / 1e6
  }
  if (toolUsage) {
    const d = toolUsage.input_tokens_details
    usd += ((d?.text_tokens ?? 0) * IMAGE_TOOL.text + (d?.image_tokens ?? 0) * IMAGE_TOOL.image + (toolUsage.output_tokens ?? 0) * IMAGE_TOOL.output) / 1e6
  }
  return Math.round(usd * 1000) / 10
}

export async function generateFashionPhoto(opts: {
  references: Buffer[]
  prompt: string
  client?: Pick<OpenAI, 'responses'>
}): Promise<{ png: Buffer; costCents: number }> {
  const client = opts.client ?? new OpenAI({ maxRetries: 2, timeout: 4 * 60_000 })
  const content: OpenAI.Responses.ResponseInputContent[] = opts.references.map((buf) => {
    // Stored pictures are WebP; label each with its real type so the API decodes it.
    const type = sniffImageType(buf) ?? 'image/png'
    return { type: 'input_image', image_url: `data:${type};base64,${buf.toString('base64')}`, detail: 'high' }
  })
  content.push({ type: 'input_text', text: `${opts.prompt}\n\nGenerate exactly one image with the image generation tool.` })

  const res = await client.responses.create({
    model: PHOTO_MODEL,
    input: [{ role: 'user', content }],
    tools: [{ type: 'image_generation', quality: photoQuality(), size: PHOTO_SIZE, output_format: 'png' }],
    tool_choice: { type: 'image_generation' },
  })
  const call = res.output.find((o) => o.type === 'image_generation_call')
  const b64 = call && 'result' in call ? call.result : null
  if (!b64) throw new Error('The image service returned no picture. Please try again.')
  const cents = photoCostCents(res.usage, res.tool_usage?.image_gen)
  return { png: Buffer.from(b64, 'base64'), costCents: Math.ceil(cents ?? FALLBACK_CENTS) }
}
