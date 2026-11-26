// VYRA Marketing hub (ZP-1200): the AI post writer. Server only.
// Claude when ANTHROPIC_API_KEY is set, OpenAI as the fallback (same as the listing writer).
// The model writes the words with placeholders; CODE fills {price}, {sizes} and {link}
// from the Product row and the post's tracking link. The model never states a price,
// size or stock level itself.
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { OPENAI_LISTING_MODEL } from '@/lib/ai/listing-text'
import { displayName, publicPriceUsd, type PriceDisplayValue } from '@/lib/storefront-model/rules'
import { getChannel, type ChannelDef } from '../channels'

// Estimated pricing in cents per token (same figures as src/lib/ai/listing-text.ts).
const CLAUDE = { input: 400 / 1_000_000, output: 2000 / 1_000_000 }
const GPT = { input: 800 / 1_000_000, output: 4000 / 1_000_000 }

export const PLACEHOLDERS = ['{price}', '{sizes}', '{link}'] as const

export interface DraftProduct {
  productName: string
  publicName?: string | null
  publicDescription?: string | null
  colours?: string | null
  sizes?: string | null
  fabric?: string | null
  care?: string | null
  fitNote?: string | null
  sellingPriceUsd: number
  priceDisplay: PriceDisplayValue | string
}

export interface DraftInput {
  product: DraftProduct
  brief?: string | null
  channels: string[]
  brandVoice?: string | null
  campaignGoal?: string | null
  /** Default "English". */
  language?: string | null
  /** Tracking link per channel kind (each post has its own). */
  links?: Record<string, string | null | undefined>
}

export interface DraftedPost {
  channel: string
  text: string
  /** Text the model wrote before the code filled the placeholders. */
  template: string
}
export interface DraftFailure {
  channel: string
  reason: string
}
export interface DraftResult {
  drafts: DraftedPost[]
  failures: DraftFailure[]
  costCents: number
  writer: 'claude' | 'openai'
}

// What the model returns (checked by parseModelOutput).
export interface ModelPost {
  channel: string
  text: string
  headline: string | null
  description: string | null
  subject: string | null
  hashtags: string[]
}

const SCHEMA = {
  type: 'object',
  properties: {
    posts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          channel: { type: 'string' },
          text: { type: 'string' },
          headline: { type: ['string', 'null'] },
          description: { type: ['string', 'null'] },
          subject: { type: ['string', 'null'] },
          hashtags: { type: 'array', items: { type: 'string' } },
        },
        required: ['channel', 'text', 'headline', 'description', 'subject', 'hashtags'],
        additionalProperties: false,
      },
    },
  },
  required: ['posts'],
  additionalProperties: false,
}

const SYSTEM = `You are the social media and marketing copywriter for VYRA, a luxury children's and family boutique. Write warm, elegant, boutique-voice copy in British spelling (unless told another language).
Write one post per requested channel, following that channel's rules exactly.
Hard rules:
- Never invent a price, size, stock level, discount, fabric, delivery promise or any other fact. Use only the product facts you are given.
- To mention the price write the placeholder {price}; to mention sizes write {sizes}; to point to the product write {link}. The shop's system replaces these. Never write a number with a currency symbol yourself. If the user message says the price is not public, never use {price}. If it says there are no sizes on file, never use {sizes}.
- Do not use emojis unless the owner's voice notes ask for them.
- No false urgency ("last chance", "selling fast") unless the brief says so.
- Return only JSON. Each post has: channel (the exact channel code given), text (the main words), headline (ads only, else null), description (ads only, else null), subject (email only, else null), hashtags (only where the channel rules allow them, without the # sign, else an empty array).`

/** What each channel wants. Pure; derived from the registry plus a few tighter writing rules. */
export function channelRules(ch: ChannelDef): { maxText: number; hashtags: number; lines: string } {
  const tight: Record<string, number> = { SMS: 160, WHATSAPP_STATUS: 140 }
  const maxText = Math.min(ch.limits.maxText, tight[ch.kind] ?? Infinity)
  const hashtags = ch.kind === 'INSTAGRAM' ? 8 : ch.kind === 'TIKTOK' ? 5 : ch.kind === 'THREADS' ? 1 : 0
  const parts: string[] = [`${ch.kind} (${ch.label}), format ${ch.formats[0]}, whole text at most ${maxText} characters after the link is added (leave about 60 characters for the link).`]
  if (ch.kind === 'SMS') parts.push('One short message, at most 160 characters including the link. No hashtags, no emojis.')
  if (ch.kind === 'WHATSAPP_STATUS') parts.push('Very short: one or two lines, a friendly nudge to look at the photo.')
  if (ch.kind === 'EMAIL') parts.push('Fill "subject" (under 60 characters) and write the body in "text" in short paragraphs.')
  if (ch.formats[0] === 'AD') parts.push('Fill "headline" (short, under 40 characters) and "description" (one short line) as well as the primary text in "text".')
  if (hashtags > 0) parts.push(`Give ${Math.min(hashtags, 5)} to ${hashtags} relevant hashtags in "hashtags".`)
  else parts.push('No hashtags.')
  if (ch.kind === 'INSTAGRAM' || ch.kind === 'TIKTOK') parts.push('Friendly and visual; the link is not clickable, so say the link is in the bio only if the brief says so.')
  return { maxText, hashtags, lines: parts.join(' ') }
}

function userText(input: DraftInput, channels: ChannelDef[]): string {
  const p = input.product
  const priceOk = publicPriceUsd({ priceDisplay: p.priceDisplay as PriceDisplayValue, sellingPriceUsd: p.sellingPriceUsd }) !== null
  const facts = [`Name: ${displayName(p)}`]
  if (p.publicDescription?.trim()) facts.push(`Description: ${p.publicDescription.trim()}`)
  if (p.colours?.trim()) facts.push(`Colours: ${p.colours.trim()}`)
  if (p.fabric?.trim()) facts.push(`Fabric: ${p.fabric.trim()}`)
  if (p.care?.trim()) facts.push(`Care: ${p.care.trim()}`)
  if (p.fitNote?.trim()) facts.push(`Fit: ${p.fitNote.trim()}`)
  const lines = [
    `Language: ${input.language?.trim() || 'English (British spelling)'}.`,
    'Product facts (use only these):',
    ...facts.map((f) => `- ${f}`),
    priceOk ? 'The price may be shown: use {price} if you mention it.' : 'The price is NOT public for this product: never use {price} and never mention cost or price.',
    p.sizes?.trim() ? 'Sizes are on file: use {sizes} if you mention them.' : 'There are no sizes on file: never use {sizes} and never mention sizes.',
    'Use {link} at most once, or leave it out; the shop adds the link at the end anyway.',
  ]
  if (input.campaignGoal?.trim()) lines.push(`Campaign goal: ${input.campaignGoal.trim()}`)
  if (input.brief?.trim()) lines.push(`What to say (owner's brief): ${input.brief.trim()}`)
  if (input.brandVoice?.trim()) lines.push(`Owner's voice notes: ${input.brandVoice.trim()}`)
  lines.push('Channels to write:', ...channels.map((c) => `- ${channelRules(c).lines}`), 'Write the posts as JSON.')
  return lines.join('\n')
}

const isStr = (v: unknown): v is string => typeof v === 'string'
const strOrNull = (v: unknown): string | null => (isStr(v) && v.trim() ? v.trim() : null)

/** Validate the model's JSON. Throws when it is not the agreed shape. */
export function parseModelOutput(json: unknown): ModelPost[] {
  const posts = typeof json === 'object' && json !== null ? (json as { posts?: unknown }).posts : undefined
  if (!Array.isArray(posts)) throw new Error('The AI reply was not in the expected shape')
  const out: ModelPost[] = []
  for (const raw of posts) {
    if (typeof raw !== 'object' || raw === null) continue
    const r = raw as Record<string, unknown>
    if (!isStr(r.channel) || !isStr(r.text)) continue
    out.push({
      channel: r.channel.trim(),
      text: r.text.trim(),
      headline: strOrNull(r.headline),
      description: strOrNull(r.description),
      subject: strOrNull(r.subject),
      hashtags: Array.isArray(r.hashtags)
        ? r.hashtags.filter(isStr).map((h) => h.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '')).filter(Boolean)
        : [],
    })
  }
  return out
}

/** A model that wrote its own money amount broke the rule: never accept it. */
const INVENTED_PRICE = /(?:[$£€]\s?\d|\b\d+(?:[.,]\d+)?\s?(?:usd|dollars?|zwl|rand|zar)\b|\busd\b)/i
const UNKNOWN_PLACEHOLDER = /\{(?!price\}|sizes\}|link\})[^{}\s]*\}/

/** Drop the sentence or line holding a placeholder we cannot fill. */
function stripSentencesWith(text: string, token: string): string {
  return text
    .split('\n')
    .map((line) =>
      line.includes(token)
        ? (line.match(/[^.!?]+[.!?]*\s*/g) ?? [line]).filter((s) => !s.includes(token)).join('').trim()
        : line,
    )
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function money(usd: number): string {
  return Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`
}

/**
 * Fill {price} and {sizes} from the product. When the price is hidden (ASK_FOR_PRICE or 0)
 * or there are no sizes, the sentence that holds the placeholder is removed.
 */
export function fillPlaceholders(template: string, product: DraftProduct): string {
  let t = template.replace(/\{link\}/g, '')
  const price = publicPriceUsd({ priceDisplay: product.priceDisplay as PriceDisplayValue, sellingPriceUsd: product.sellingPriceUsd })
  t = price === null ? stripSentencesWith(t, '{price}') : t.replace(/\{price\}/g, money(price))
  const sizes = product.sizes?.trim()
  t = sizes ? t.replace(/\{sizes\}/g, sizes) : stripSentencesWith(t, '{sizes}')
  return t.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

function cutAtWord(s: string, max: number): string {
  if (s.length <= max) return s
  const cut = s.slice(0, Math.max(0, max - 1))
  const sp = cut.lastIndexOf(' ')
  return `${(sp > max * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, '')}…`
}

/**
 * Turn one model post into the final text for its channel, or return why it cannot be used.
 * Over-length text is trimmed at a word boundary when only the body must give way; if it
 * still cannot fit, the channel is rejected rather than posting something cut off.
 */
export function assemblePost(mp: ModelPost, ch: ChannelDef, product: DraftProduct, link: string | null): { text: string; template: string } | { error: string } {
  const rules = channelRules(ch)
  const raw = [mp.text, mp.headline, mp.description, mp.subject].filter(Boolean).join('\n')
  if (UNKNOWN_PLACEHOLDER.test(raw)) return { error: 'The AI used a placeholder we do not know.' }
  if (INVENTED_PRICE.test(raw)) return { error: 'The AI wrote its own price, which is not allowed.' }
  if (!mp.text.trim()) return { error: 'The AI wrote no text.' }

  const isAd = ch.formats[0] === 'AD'
  const isEmail = ch.kind === 'EMAIL'
  if (isAd && !mp.headline) return { error: 'The AI wrote no headline for the ad.' }
  if (isEmail && !mp.subject) return { error: 'The AI wrote no subject line for the email.' }

  const tags = rules.hashtags > 0 ? [...new Set(mp.hashtags)].slice(0, rules.hashtags).map((h) => `#${h}`).join(' ') : ''
  const fill = (s: string | null) => (s ? fillPlaceholders(s, product) : '')
  const head = fill(mp.headline)
  const desc = fill(mp.description)
  const subject = fill(mp.subject)
  const linkLine = link ?? ''

  const build = (body: string): string => {
    const blocks: string[] = []
    if (isEmail) blocks.push(`Subject: ${subject}`)
    if (isAd && head) blocks.push(head)
    if (body) blocks.push(body)
    if (isAd && desc) blocks.push(desc)
    if (linkLine) blocks.push(linkLine)
    if (tags) blocks.push(tags)
    return blocks.join('\n\n')
  }

  let body = fill(mp.text)
  if (!body) return { error: 'Nothing was left of the text after removing details we cannot show.' }
  let text = build(body)
  if (text.length > rules.maxText) {
    const over = text.length - rules.maxText
    body = cutAtWord(body, body.length - over)
    text = build(body)
  }
  if (text.length > rules.maxText || body.replace(/…$/, '').trim().length < 15) {
    return { error: `The AI text did not fit in ${rules.maxText} characters for ${ch.label}.` }
  }
  return { text, template: mp.text }
}

type Fns = { client?: Pick<Anthropic, 'messages'>; openai?: Pick<OpenAI, 'responses'> }

/** Claude first; OpenAI when there is no Claude key or the Claude call fails (for example out of credit). */
export async function draftPosts(input: DraftInput, fns: Fns = {}): Promise<DraftResult> {
  const kinds = [...new Set(input.channels)]
  const channels = kinds.map((k) => {
    const ch = getChannel(k)
    if (!ch) throw new Error(`Unknown channel "${k}"`)
    return ch
  })
  if (channels.length === 0) throw new Error('Choose at least one channel')
  const hasClaude = Boolean(fns.client || process.env.ANTHROPIC_API_KEY)
  const hasOpenAI = Boolean(fns.openai || process.env.OPENAI_API_KEY)
  if (!hasClaude && !hasOpenAI) throw new Error('No AI key is set up for the marketing writer')
  const prompt = userText(input, channels)

  let raw: { text: string; costCents: number; writer: 'claude' | 'openai' }
  if (hasClaude) {
    try {
      raw = await writeWithClaude(prompt, fns.client ?? new Anthropic())
    } catch (error) {
      if (!hasOpenAI || !(error instanceof Anthropic.APIError)) throw error
      console.warn('[marketing] Claude writer failed, using OpenAI:', error.status, error.message)
      raw = await writeWithOpenAI(prompt, fns.openai ?? new OpenAI({ maxRetries: 2 }))
    }
  } else {
    raw = await writeWithOpenAI(prompt, fns.openai ?? new OpenAI({ maxRetries: 2 }))
  }

  let json: unknown
  try {
    json = JSON.parse(raw.text)
  } catch {
    throw new Error('The AI reply was not valid JSON')
  }
  const modelPosts = parseModelOutput(json)
  const drafts: DraftedPost[] = []
  const failures: DraftFailure[] = []
  for (const ch of channels) {
    const mp = modelPosts.find((m) => m.channel === ch.kind)
    if (!mp) {
      failures.push({ channel: ch.kind, reason: 'The AI did not write this channel.' })
      continue
    }
    const res = assemblePost(mp, ch, input.product, input.links?.[ch.kind] ?? null)
    if ('error' in res) failures.push({ channel: ch.kind, reason: res.error })
    else drafts.push({ channel: ch.kind, text: res.text, template: res.template })
  }
  return { drafts, failures, costCents: raw.costCents, writer: raw.writer }
}

async function writeWithClaude(prompt: string, client: Pick<Anthropic, 'messages'>) {
  const msg = await client.messages.create({
    model: process.env.ANTHROPIC_MARKETING_MODEL || process.env.ANTHROPIC_LISTING_MODEL || 'claude-opus-5-5',
    max_tokens: 4000,
    system: SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: [{ type: 'text' as const, text: prompt }] }],
  })
  if (msg.stop_reason === 'refusal') throw new Error('The AI declined to write this post')
  const block = msg.content.find((b) => b.type === 'text')
  if (!block || block.type !== 'text') throw new Error('The AI returned no text')
  const costCents = Math.ceil(msg.usage.input_tokens * CLAUDE.input + msg.usage.output_tokens * CLAUDE.output)
  return { text: block.text, costCents, writer: 'claude' as const }
}

async function writeWithOpenAI(prompt: string, client: Pick<OpenAI, 'responses'>) {
  const res = await client.responses.create({
    model: OPENAI_LISTING_MODEL,
    instructions: SYSTEM,
    reasoning: { effort: 'low' },
    input: [{ role: 'user', content: [{ type: 'input_text' as const, text: prompt }] }],
    text: { format: { type: 'json_schema', name: 'marketing_posts', schema: SCHEMA, strict: true } },
  })
  const refused = res.output.some((o) => o.type === 'message' && o.content.some((c) => c.type === 'refusal'))
  if (refused) throw new Error('The AI declined to write this post')
  if (!res.output_text) throw new Error('The AI returned no text')
  const u = res.usage
  const costCents = Math.ceil((u?.input_tokens ?? 0) * GPT.input + (u?.output_tokens ?? 0) * GPT.output)
  return { text: res.output_text, costCents, writer: 'openai' as const }
}
