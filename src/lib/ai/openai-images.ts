// GPT Image wrapper. Server-only.
import OpenAI, { toFile } from 'openai'
import { sniffImageType } from '@/lib/storage/images'

// Rough per-image cost estimates in cents (not billing-accurate).
const COST_CENTS: Record<string, number> = { high: 20, medium: 6, low: 2 }

export async function generateFashionPhoto(opts: {
  references: Buffer[]
  prompt: string
  client?: Pick<OpenAI, 'images'>
}): Promise<{ png: Buffer; costCents: number }> {
  const client = opts.client ?? new OpenAI()
  const quality = (process.env.OPENAI_IMAGE_QUALITY || 'high') as 'low' | 'medium' | 'high'
  const model = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1.5'
  const images = await Promise.all(
    opts.references.map((buf, i) => {
      // Stored pictures are WebP; label each with its real type so the API decodes it.
      const type = sniffImageType(buf) ?? 'image/png'
      return toFile(buf, `reference-${i + 1}.${type.split('/')[1]}`, { type })
    }),
  )
  const res = await client.images.edit({
    model,
    image: images,
    prompt: opts.prompt,
    quality,
    size: '1024x1536',
    n: 1,
  })
  const b64 = res.data?.[0]?.b64_json
  if (!b64) throw new Error('The image service returned no picture')
  return { png: Buffer.from(b64, 'base64'), costCents: COST_CENTS[quality] ?? COST_CENTS.high }
}
