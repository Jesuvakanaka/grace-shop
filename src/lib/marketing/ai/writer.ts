// VYRA Marketing hub (ZP-1200): the AI post writer. Server only.
// Claude when ANTHROPIC_API_KEY is set, OpenAI as the fallback (same as the listing writer).
// The writer is handed a brief (job, reader, one message, proof, a TRUE reason to act now, one
// action) and writes the piece that does that job on each channel. It writes the words with
// placeholders; CODE fills {price}, {sizes} and {link} from the Product row and the post's
// tracking link. The model never states a price, size or stock level itself.
// Each draft is then checked against its brief (by code, then by a second AI pass) and
// rewritten once when it fails.
import { displayName, publicPriceUsd, type PriceDisplayValue } from '@/lib/storefront-model/rules'
import { JOB_PROMPT, type BriefPlan } from '../brief'
import { getChannel, type ChannelDef } from '../channels'
import { callJson, hasAiKey, type AiFns } from './call'
import { checkDrafts } from './check'
import { shopIdentity, type ShopIdentity } from './shop'
import { truthProblems, type TruthFacts } from '../product-truth'

export const PLACEHOLDERS = ['{price}', '{sizes}', '{link}', '{wholesale}'] as const

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
  /** ZP-1106: the wholesale offer as code words it ("$12 each when you buy 6 or more"), only when it may be said. */
  wholesaleText?: string | null
}

/** ZP-1106 (MM-01): the product's truth for the writer and the code check (see product-truth.ts). */
export interface DraftTruth {
  facts: TruthFacts
  /** Availability, known policies and "never mention" lines, added to the product facts. */
  lines: string[]
}

export interface DraftInput {
  product: DraftProduct
  /** The structured brief. Without one the piece is an offer and the writer picks reader and message from the facts. */
  plan?: BriefPlan | null
  /** The owner's free-text note. */
  brief?: string | null
  channels: string[]
  shop?: ShopIdentity | null
  brandVoice?: string | null
  campaignName?: string | null
  campaignGoal?: string | null
  /** Default "English". */
  language?: string | null
  /** Tracking link per channel kind (each post has its own). */
  links?: Record<string, string | null | undefined>
  /** false skips the second AI pass (the code checks always run). Default true. */
  check?: boolean
  /** ZP-1106: availability, policies and wholesale terms. Without it nothing is said about them (older callers). */
  truth?: DraftTruth | null
}

export interface DraftedPost {
  channel: string
  text: string
  /** Text the model wrote before the code filled the placeholders. */
  template: string
  /** Other first lines the owner can swap in. */
  openings: string[]
  /** What the check still found weak, in plain words. Empty when the draft passed. */
  notes: string[]
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
  openings: string[]
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
          openings: { type: 'array', items: { type: 'string' } },
        },
        required: ['channel', 'text', 'openings', 'headline', 'description', 'subject', 'hashtags'],
        additionalProperties: false,
      },
    },
  },
  required: ['posts'],
  additionalProperties: false,
}

/** The fixed instructions. The brief does the thinking; this prompt only carries it out. */
export function writerSystem(shop: ShopIdentity): string {
  return `You write marketing for ${shop.name}, ${shop.description}. Your work is judged by one thing: whether it moves the reader to the action named in the brief. Clear and specific beats clever. Honest beats impressive.

You are given a brief. It names the job of this piece, the reader, the one message, the proof, the reason to act now if there is a true one, and the one action. The thinking has been done. Do not change the brief and do not add to it. Your task is to carry it out well on each channel requested.

HOW TO WRITE
- Write to one person: the reader in the brief, in the moment the brief describes. Say "you". Talk about them and what they get, not about the shop.
- The first line must earn the second. Open with the reader's moment, a result they want, or one specific detail. Never open with the shop's name, the product's name, "Introducing", "Meet", "We are excited", or a question the reader can answer "no" to.
- Land the one message, and only that one. Say what the product does for the reader, not what the product is.
- Be specific. A phrase that could describe a thousand other products, such as "high quality", "perfect for any occasion", "must-have", "timeless" or "elevate", must be replaced by a concrete detail from the product facts, or cut.
- State the proof plainly, as a fact. Do not decorate it.
- End with the one action from the brief, as a single clear instruction. Never offer two actions.
- Sound like someone who works in the shop talking to a customer they like. Short sentences. Follow the owner's voice notes.

THE SHAPE DEPENDS ON THE JOB
- GET SEEN: an opening the reader recognises themselves in, then something worth their time (a tip, an idea, a small true-to-life moment), then a light ask to follow, save or share. The product may appear but is not being sold. No price.
- EARN TRUST: an opening, then the proof told properly (the detail, the customer's words, or the honest answer to the doubt), then an invitation to look or to ask.
- GET PERMISSION: what joining the list gives the reader, why it is worth joining, how to join. Nothing else.
- OFFER AND CLOSE: the opening, the result the reader wants, the proof, the offer with the reason to act now, the one action. The price belongs here when it may be shown.
- KEEP CUSTOMERS: thanks, something useful for what they bought, one small ask.

TRUTH RULES, WITH NO EXCEPTIONS
- Use only the product facts and the brief. Never invent a price, size, stock level, discount, material, delivery promise, review or customer.
- Reason to act now: use only the one in the brief. Say it once, keeping its facts and figures exactly. When the brief says there is none, write no urgency of any kind: no "limited", "hurry", "don't miss out", "while stocks last" or anything like them.
- To mention the price write {price}. To mention sizes write {sizes}. To point to the product write {link}, at most once. The shop's system replaces these. Never write a number with a currency symbol yourself. When told the price is not public, never use {price} or mention cost. When told there are no sizes on file, never use {sizes} or mention sizes.
- No emojis unless the owner's voice notes ask for them.

FIT THE CHANNEL
- Write one post for each channel requested and follow that channel's rule line exactly.
- On a very short channel, keep the opening and the action and drop the middle.
- Never mention a photo, picture or video in the words (no "pictured here", no "see the photo"). You do not know which image will go with the post.

WHAT TO RETURN
JSON only. For each post: channel (the exact channel code given), text (the main words), openings (two other first lines that could replace the first line of text, each taking a different way in), headline (ads only, else null), description (ads only, else null), subject (email only, else null), hashtags (only where the channel rules allow them, without the # sign, else an empty array).`
}

/** What each channel wants. Pure; derived from the registry plus a few tighter writing rules. */
export function channelRules(ch: ChannelDef, link?: string | null): { maxText: number; words: number; hashtags: number; lines: string } {
  // The link is added under the words. An SMS counts it; a WhatsApp Status caption gets 140 characters of words on top of it.
  const linkRoom = link ? link.length + 2 : 0
  const tight: Record<string, number> = { SMS: 160, WHATSAPP_STATUS: 140 + linkRoom }
  const maxText = Math.min(ch.limits.maxText, tight[ch.kind] ?? Infinity)
  const words = Math.max(0, maxText - linkRoom)
  const hashtags = ch.kind === 'INSTAGRAM' ? 8 : ch.kind === 'TIKTOK' ? 5 : ch.kind === 'THREADS' ? 1 : 0
  const parts: string[] = [`${ch.kind} (${ch.label}), format ${ch.formats[0]}, your words at most ${words} characters${link ? ' (the link is added after them and is already allowed for)' : ''}. Text over the limit is cut off and loses its ending, so stay under it.`]
  if (ch.kind === 'SMS') parts.push('One short message. No hashtags, no emojis.')
  if (ch.kind === 'WHATSAPP_STATUS') parts.push('Very short: one or two lines. The reader\'s moment or one detail of the product, then the action from the brief.')
  if (ch.kind === 'EMAIL') parts.push('Fill "subject" (under 60 characters) and write the body in "text" in short paragraphs.')
  if (ch.formats[0] === 'AD') parts.push('Fill "headline" (short, under 40 characters) and "description" (one short line) as well as the primary text in "text".')
  if (hashtags > 0) parts.push(`Give ${Math.min(hashtags, 5)} to ${hashtags} relevant hashtags in "hashtags".`)
  else parts.push('No hashtags.')
  if (ch.kind === 'INSTAGRAM' || ch.kind === 'TIKTOK') parts.push('Friendly and visual; the link is not clickable, so say the link is in the bio only if the brief says so.')
  return { maxText, words, hashtags, lines: parts.join(' ') }
}

const DEFAULT_PLAN: BriefPlan = { job: 'OFFER_CLOSE', reader: null, message: null, proof: null, urgency: null, action: 'Message us to order' }
const planOf = (input: DraftInput): BriefPlan => input.plan ?? DEFAULT_PLAN

/** The brief as the writer and the checker read it. */
export function briefBlock(input: DraftInput): string {
  const b = planOf(input)
  const lines = [
    'THE BRIEF',
    `Job: ${JOB_PROMPT[b.job]}`,
    b.reader ? `Reader: ${b.reader}` : 'Reader: not given. Write for the person most likely to want this product, judging from the product facts.',
    b.message ? `One message: ${b.message}` : 'One message: not given. Choose the single strongest reason to want this product from the product facts.',
    b.proof ? `Proof: ${b.proof}` : 'Proof: none given. Use one product fact as proof.',
    b.urgency ? `Reason to act now: ${b.urgency}` : 'Reason to act now: NONE. Write no urgency.',
    `One action: ${b.action}`,
  ]
  if (input.brief?.trim()) lines.push(`Owner's note: ${input.brief.trim()}`)
  if (input.campaignName?.trim() || input.campaignGoal?.trim()) {
    lines.push(`Campaign: ${[input.campaignName?.trim(), input.campaignGoal?.trim()].filter(Boolean).join(', ')}`)
  }
  return lines.join('\n')
}

/** The product facts, and which placeholders may be used. Never contains the price or the sizes. */
export function factsBlock(input: DraftInput): string {
  const p = input.product
  const priceOk = publicPriceUsd({ priceDisplay: p.priceDisplay as PriceDisplayValue, sellingPriceUsd: p.sellingPriceUsd }) !== null
  const facts = [`Name: ${displayName(p)}`]
  if (p.publicDescription?.trim()) facts.push(`Description: ${p.publicDescription.trim()}`)
  if (p.colours?.trim()) facts.push(`Colours: ${p.colours.trim()}`)
  if (p.fabric?.trim()) facts.push(`Fabric: ${p.fabric.trim()}`)
  if (p.care?.trim()) facts.push(`Care: ${p.care.trim()}`)
  if (p.fitNote?.trim()) facts.push(`Fit: ${p.fitNote.trim()}`)
  return [
    'Product facts (use only these):',
    ...facts.map((f) => `- ${f}`),
    priceOk ? 'The price may be shown: use {price} if you mention it.' : 'The price is NOT public for this product: never use {price} and never mention cost or price.',
    p.sizes?.trim() ? 'Sizes are on file: use {sizes} if you mention them.' : 'There are no sizes on file: never use {sizes} and never mention sizes.',
    ...(input.truth ? input.truth.lines : ['Delivery, returns, stock and wholesale terms are not given: never mention them.']),
  ].join('\n')
}

function userText(input: DraftInput, channels: ChannelDef[]): string {
  const lines = [`Language: ${input.language?.trim() || 'English (British spelling)'}.`, '', briefBlock(input), '', factsBlock(input)]
  if (input.brandVoice?.trim()) lines.push('', `Owner's voice notes: ${input.brandVoice.trim()}`)
  lines.push('', 'Channels to write:', ...channels.map((c) => `- ${channelRules(c, input.links?.[c.kind]).lines}`), 'Write the posts as JSON.')
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
      openings: Array.isArray(r.openings) ? r.openings.filter(isStr).map((o) => o.trim()).filter(Boolean) : [],
    })
  }
  return out
}

/** A model that wrote its own money amount broke the rule: never accept it. */
const INVENTED_PRICE = /(?:[$£€]\s?\d|\b\d+(?:[.,]\d+)?\s?(?:usd|dollars?|zwl|rand|zar)\b|\busd\b)/i
const UNKNOWN_PLACEHOLDER = /\{(?!price\}|sizes\}|link\}|wholesale\})[^{}\s]*\}/

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
  const wholesale = product.wholesaleText?.trim()
  t = wholesale ? t.replace(/\{wholesale\}/g, wholesale) : stripSentencesWith(t, '{wholesale}')
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
export function assemblePost(mp: ModelPost, ch: ChannelDef, product: DraftProduct, link: string | null): { text: string; template: string; cut?: boolean } | { error: string } {
  const rules = channelRules(ch, link)
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
  const cut = text.length > rules.maxText
  if (cut) {
    const over = text.length - rules.maxText
    body = cutAtWord(body, body.length - over)
    text = build(body)
  }
  if (text.length > rules.maxText || body.replace(/…$/, '').trim().length < 15) {
    return { error: `The AI text did not fit in ${rules.maxText} characters for ${ch.label}.` }
  }
  return { text, template: mp.text, ...(cut ? { cut } : {}) }
}

/** Words that push the reader to hurry. Only allowed when the brief gives a true reason to act now. */
const URGENCY = /\b(hurry|last chance|selling fast|going fast|don'?t miss(?: out)?|while (?:stocks?|supplies) lasts?|limited (?:stock|time|quantity|quantities|numbers?|availability)|only (?:a few|\w+) left|(?:almost|nearly) gone|running out|before (?:it'?s|they'?re|it is|they are) gone|ends? (?:soon|today|tonight|tomorrow)|act (?:now|fast)|today only)\b/i
const NUMBER = /\d+(?:[.,]\d+)*/g
const PHOTO = /\b(pictured|in (?:the|this) (?:photo|picture|image|video)|(?:see|look at|check out) the (?:photo|picture|image|video)|(?:photo|picture) (?:above|below|here))\b/i
const OPENERS = ['introducing', 'meet ', 'we are excited', "we're excited", 'we’re excited']

export interface SoftProblems {
  /** Breaks a truth rule: a draft that still has one after the rewrite is thrown away. */
  truth: string[]
  /** Weak, not false: the draft is kept and the owner is told. */
  style: string[]
}

/**
 * The code's own checks on what the model wrote (before placeholders are filled):
 * no urgency the brief did not give, no figure that is not in the brief or the facts,
 * and no first line that opens on the shop, the product or "Introducing".
 * `allowed` is everything the model was told that it may repeat.
 */
export function softProblems(mp: Pick<ModelPost, 'text' | 'headline' | 'description' | 'subject'>, ctx: { urgency: string | null; allowed: string; names: string[]; truth?: TruthFacts | null; truthAllowed?: string }): SoftProblems {
  const raw = [mp.text, mp.headline, mp.description, mp.subject].filter(Boolean).join('\n')
  const allowed = ctx.allowed.toLowerCase()
  const truth: string[] = []
  const style: string[] = []
  if (!ctx.urgency) {
    const m = raw.match(URGENCY)
    if (m && !allowed.includes(m[0].toLowerCase())) truth.push(`It adds urgency ("${m[0]}") but the brief gives no reason to act now. Remove it.`)
  }
  const known = new Set(allowed.match(NUMBER) ?? [])
  const made = [...new Set(raw.match(NUMBER) ?? [])].filter((n) => !known.has(n))
  // ZP-1106 (MM-01-AC2/AC4/AC5): unknown policies, pre-order stock claims and wholesale terms, checked by code.
  // Only the owner's own words count as allowed here, never the "never mention" instructions themselves.
  if (ctx.truth) truth.push(...truthProblems(raw, ctx.truth, ctx.truthAllowed ?? ''))
  if (made.length > 0) truth.push(`It uses ${made.length === 1 ? 'a figure' : 'figures'} (${made.join(', ')}) that ${made.length === 1 ? 'is' : 'are'} not in the brief or the product facts. Remove ${made.length === 1 ? 'it' : 'them'}.`)
  const first = (mp.text.split('\n').find((l) => l.trim()) ?? '').trim().toLowerCase()
  const opener = [...ctx.names.map((n) => n.trim().toLowerCase()).filter((n) => n.length >= 3), ...OPENERS].find((o) => first.startsWith(o))
  if (opener) style.push(`The first line opens with "${opener.trim()}". Open with the reader's moment, a result they want or one specific detail.`)
  const photo = raw.match(PHOTO)
  if (photo) style.push(`It talks about the photo ("${photo[0]}"). Describe the product in words, because the writer cannot see which photo goes with the post.`)
  return { truth, style }
}

/** Other first lines, with placeholders filled. Anything untrue or unusable is dropped, never shown. */
function usableOpenings(mp: ModelPost, product: DraftProduct, ctx: { urgency: string | null; allowed: string; names: string[]; truth?: TruthFacts | null; truthAllowed?: string }): string[] {
  const first = (mp.text.split('\n').find((l) => l.trim()) ?? '').trim()
  const out: string[] = []
  for (const o of mp.openings) {
    if (UNKNOWN_PLACEHOLDER.test(o) || INVENTED_PRICE.test(o) || o.includes('\n')) continue
    const p = softProblems({ text: o, headline: null, description: null, subject: null }, ctx)
    if (p.truth.length > 0 || p.style.length > 0) continue
    const t = fillPlaceholders(o, product)
    if (!t || t.length > 200 || t === fillPlaceholders(first, product) || out.includes(t)) continue
    out.push(t)
  }
  return out.slice(0, 2)
}

type Fns = AiFns
type Judged = { mp: ModelPost; built: { text: string; template: string; cut?: boolean }; soft: SoftProblems } | { error: string }

/** Channels this short keep only the opening and the action, so the fuller checks do not apply. */
export const SHORT_CHANNEL_MAX = 300

/**
 * Write one post per channel from the brief, check each draft and rewrite the ones that fail, once.
 * Claude first; OpenAI when there is no Claude key or the Claude call fails (for example out of credit).
 */
export async function draftPosts(input: DraftInput, fns: Fns = {}): Promise<DraftResult> {
  const kinds = [...new Set(input.channels)]
  const channels = kinds.map((k) => {
    const ch = getChannel(k)
    if (!ch) throw new Error(`Unknown channel "${k}"`)
    return ch
  })
  if (channels.length === 0) throw new Error('Choose at least one channel')
  const has = hasAiKey(fns)
  if (!has.claude && !has.openai) throw new Error('No AI key is set up for the marketing writer')

  const shop = input.shop ?? shopIdentity(null)
  const system = writerSystem(shop)
  const plan = planOf(input)
  const briefText = briefBlock(input)
  const factsText = factsBlock(input)
  const ctx = {
    urgency: plan.urgency,
    allowed: [briefText, factsText, input.brandVoice ?? ''].join('\n'),
    names: [shop.name, displayName(input.product)],
    truth: input.truth?.facts ?? null,
    truthAllowed: [briefText, input.brandVoice ?? '', input.product.publicDescription ?? '', input.product.fabric ?? '', input.product.care ?? '', input.product.fitNote ?? ''].join('\n'),
  }
  let costCents = 0
  let writer: 'claude' | 'openai' = 'claude'

  const write = async (chs: ChannelDef[], extra = ''): Promise<ModelPost[]> => {
    const raw = await callJson({ system, prompt: userText(input, chs) + extra, schema: SCHEMA, name: 'marketing_posts', task: 'write this post' }, fns)
    costCents += raw.costCents
    writer = raw.writer
    let json: unknown
    try {
      json = JSON.parse(raw.text)
    } catch {
      throw new Error('The AI reply was not valid JSON')
    }
    return parseModelOutput(json)
  }
  const judge = (posts: ModelPost[], ch: ChannelDef): Judged => {
    const mp = posts.find((m) => m.channel === ch.kind)
    if (!mp) return { error: 'The AI did not write this channel.' }
    const built = assemblePost(mp, ch, input.product, input.links?.[ch.kind] ?? null)
    if ('error' in built) return built
    const soft = softProblems(mp, ctx)
    // A post that had to be cut has lost its ending, which is where the action is.
    if (built.cut) soft.style.push(`It was too long for ${ch.label} and was cut off before the end. Keep the words under ${channelRules(ch, input.links?.[ch.kind]).words} characters and still end with the action.`)
    return { mp, built, soft }
  }
  /** The second AI pass. It never blocks the writing: when it cannot answer, the drafts go through unchecked. */
  const aiCheck = async (rows: { ch: ChannelDef; mp: ModelPost }[]): Promise<Record<string, string[]>> => {
    if (input.check === false || rows.length === 0) return {}
    try {
      const r = await checkDrafts(
        { briefText, factsText, job: plan.job, drafts: rows.map((x) => ({ channel: x.ch.kind, text: [x.mp.subject, x.mp.headline, x.mp.text, x.mp.description].filter(Boolean).join('\n'), short: channelRules(x.ch).maxText <= SHORT_CHANNEL_MAX })) },
        fns,
      )
      costCents += r.costCents
      return r.fixes
    } catch (error) {
      console.warn('[marketing] draft check skipped:', error instanceof Error ? error.message : error)
      return {}
    }
  }

  const first = new Map<string, Judged>()
  const firstPosts = await write(channels)
  for (const ch of channels) first.set(ch.kind, judge(firstPosts, ch))
  const ok = (j: Judged | undefined): j is Exclude<Judged, { error: string }> => Boolean(j && !('error' in j))
  const firstFixes = await aiCheck(channels.flatMap((ch) => { const j = first.get(ch.kind); return ok(j) ? [{ ch, mp: j.mp }] : [] }))

  // What must be fixed, per channel. Channels with a hard failure (a made-up price, text that cannot fit) are not retried.
  const problems = new Map<string, string[]>()
  for (const ch of channels) {
    const j = first.get(ch.kind)
    if (!ok(j)) continue
    const list = [...j.soft.truth, ...j.soft.style, ...(firstFixes[ch.kind] ?? [])]
    if (list.length > 0) problems.set(ch.kind, list)
  }

  const final = new Map<string, Judged>(first)
  const notes = new Map<string, string[]>()
  if (problems.size > 0) {
    const redo = channels.filter((ch) => problems.has(ch.kind))
    const extra = [
      '',
      '',
      'REWRITE. Your earlier drafts for these channels did not pass the check. Write them again and fix every point listed.',
      ...redo.flatMap((ch) => {
        const j = first.get(ch.kind) as Exclude<Judged, { error: string }>
        return [`- ${ch.kind}: ${(problems.get(ch.kind) ?? []).join(' ')}`, `  Earlier draft: """${j.mp.text}"""`]
      }),
    ].join('\n')
    let second: ModelPost[] | null = null
    try {
      second = await write(redo, extra)
    } catch (error) {
      console.warn('[marketing] rewrite after the check failed, keeping the first drafts:', error instanceof Error ? error.message : error)
    }
    if (second) {
      const improved: { ch: ChannelDef; mp: ModelPost }[] = []
      for (const ch of redo) {
        const j = judge(second, ch)
        // A rewrite that cannot be used does not replace a usable first draft.
        if (ok(j)) { final.set(ch.kind, j); improved.push({ ch, mp: j.mp }) }
      }
      const secondFixes = await aiCheck(improved)
      for (const ch of redo) {
        const rewritten = improved.some((x) => x.ch.kind === ch.kind)
        const left = rewritten ? (secondFixes[ch.kind] ?? []) : (firstFixes[ch.kind] ?? [])
        if (left.length > 0) notes.set(ch.kind, left)
      }
    } else {
      for (const ch of redo) if ((firstFixes[ch.kind] ?? []).length > 0) notes.set(ch.kind, firstFixes[ch.kind])
    }
  }

  const drafts: DraftedPost[] = []
  const failures: DraftFailure[] = []
  for (const ch of channels) {
    const j = final.get(ch.kind)
    if (!j || 'error' in j) {
      failures.push({ channel: ch.kind, reason: j ? j.error : 'The AI did not write this channel.' })
      continue
    }
    if (j.soft.truth.length > 0) {
      failures.push({ channel: ch.kind, reason: `The AI wrote something the brief does not back, so this draft was thrown away. ${j.soft.truth[0]}` })
      continue
    }
    drafts.push({
      channel: ch.kind,
      text: j.built.text,
      template: j.built.template,
      openings: usableOpenings(j.mp, input.product, ctx),
      notes: [...j.soft.style, ...(notes.get(ch.kind) ?? [])],
    })
  }
  return { drafts, failures, costCents, writer }
}
