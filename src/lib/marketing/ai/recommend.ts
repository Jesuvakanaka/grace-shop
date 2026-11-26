// VYRA Marketing hub (ZP-1200): weekly advice for the owner. Server only.
// 1. CODE works out the facts (best channel, best product, best day and hour, posts nobody visited, channels not
//    used, budget left) and writes a plain rule-based text for each.
// 2. The AI (when a key exists) only rewrites that text in friendlier words. The AI never invents numbers: every
//    number in its text must already be in the rule text, otherwise that item keeps the rule text.
// Without any AI key the rule text is saved as it is.
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import type { MarketingRecommendation } from '@prisma/client'
import { OPENAI_LISTING_MODEL } from '@/lib/ai/listing-text'
import { WebsiteError } from '@/lib/website/http'
import { writeAudit, type Db } from '../audit'
import { budgetSummary } from '../budget'
import { getChannel } from '../channels'
import { hararedayString, resultsReport, ymd } from '../results'
import { getSettings } from '../settings'
import type { Actor } from '../state'

const DAY_MS = 86_400_000
const HARARE_MS = 2 * 3_600_000
const CLAUDE = { input: 400 / 1_000_000, output: 2000 / 1_000_000 }
const GPT = { input: 800 / 1_000_000, output: 4000 / 1_000_000 }
export const RECOMMENDATION_STATUSES = ['NEW', 'DONE', 'DISMISSED'] as const
export type RecommendationStatus = (typeof RECOMMENDATION_STATUSES)[number]
export const WINDOW_DAYS = 28
const MIN_POSTS_FOR_TIMING = 3
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`

// ───────────────────────── facts (pure) ─────────────────────────

export interface FactsInput {
  from: string
  to: string
  posts: { postId: number; title: string; channelKind: string; productId: number | null; productName: string | null; publishedAt: Date | null; visits: number; enquiries: number }[]
  /** Connected channels and how many posts each had in the window. */
  channels: { kind: string; postsInWindow: number }[]
  budget: { month: string; capCents: number; committedCents: number; remainingCents: number }
  now: Date
}

export interface Facts {
  window: { from: string; to: string }
  postCount: number
  bestChannel: { kind: string; label: string; visits: number; enquiries: number; posts: number } | null
  bestProduct: { productId: number; name: string; visits: number; enquiries: number } | null
  bestDay: { day: string; avgVisits: number; posts: number } | null
  bestHour: { hour: number; avgVisits: number; posts: number } | null
  postsWithNoVisits: { count: number; examples: { postId: number; title: string; channel: string }[] }
  unusedChannels: { kind: string; label: string }[]
  budget: { month: string; capCents: number; remainingCents: number }
}

const rank = <T extends { visits: number; enquiries: number }>(a: T, b: T) => b.visits - a.visits || b.enquiries - a.enquiries

export function computeFacts(input: FactsInput): Facts {
  const { posts } = input
  // best channel and product by visits (enquiries break ties); nothing is "best" when nobody visited.
  const ch = new Map<string, { visits: number; enquiries: number; posts: number }>()
  const pr = new Map<number, { name: string; visits: number; enquiries: number }>()
  for (const p of posts) {
    const c = ch.get(p.channelKind) ?? { visits: 0, enquiries: 0, posts: 0 }
    c.visits += p.visits; c.enquiries += p.enquiries; c.posts++
    ch.set(p.channelKind, c)
    if (p.productId) {
      const x = pr.get(p.productId) ?? { name: p.productName ?? `Product ${p.productId}`, visits: 0, enquiries: 0 }
      x.visits += p.visits; x.enquiries += p.enquiries
      pr.set(p.productId, x)
    }
  }
  const topCh = [...ch.entries()].map(([kind, v]) => ({ kind, label: getChannel(kind)?.label ?? kind, ...v })).sort(rank)[0]
  const topPr = [...pr.entries()].map(([productId, v]) => ({ productId, ...v })).sort(rank)[0]

  // best day and hour (Harare time) by average visits per post, only with enough posts to mean something
  const timed = posts.filter((p) => p.publishedAt)
  const avgBy = (key: (d: Date) => number) => {
    const m = new Map<number, { visits: number; posts: number }>()
    for (const p of timed) {
      const k = key(new Date(p.publishedAt!.getTime() + HARARE_MS))
      const v = m.get(k) ?? { visits: 0, posts: 0 }
      v.visits += p.visits; v.posts++
      m.set(k, v)
    }
    return [...m.entries()].map(([k, v]) => ({ k, posts: v.posts, avgVisits: Math.round((v.visits / v.posts) * 10) / 10 })).sort((a, b) => b.avgVisits - a.avgVisits || b.posts - a.posts)[0]
  }
  const enough = timed.length >= MIN_POSTS_FOR_TIMING
  const day = enough ? avgBy((d) => d.getUTCDay()) : undefined
  const hour = enough ? avgBy((d) => d.getUTCHours()) : undefined

  // posts nobody visited (give a post two days before judging it)
  const cutoff = input.now.getTime() - 2 * DAY_MS
  const empty = posts.filter((p) => p.publishedAt && p.publishedAt.getTime() <= cutoff && p.visits === 0)

  const unused = input.channels.filter((c) => c.postsInWindow === 0).map((c) => ({ kind: c.kind, label: getChannel(c.kind)?.label ?? c.kind }))
  return {
    window: { from: input.from, to: input.to },
    postCount: posts.length,
    bestChannel: topCh && topCh.visits > 0 ? { kind: topCh.kind, label: topCh.label, visits: topCh.visits, enquiries: topCh.enquiries, posts: topCh.posts } : null,
    bestProduct: topPr && topPr.visits > 0 ? topPr : null,
    bestDay: day && day.avgVisits > 0 ? { day: DAY_NAMES[day.k], avgVisits: day.avgVisits, posts: day.posts } : null,
    bestHour: hour && hour.avgVisits > 0 ? { hour: hour.k, avgVisits: hour.avgVisits, posts: hour.posts } : null,
    postsWithNoVisits: { count: empty.length, examples: empty.slice(0, 3).map((p) => ({ postId: p.postId, title: p.title, channel: getChannel(p.channelKind)?.label ?? p.channelKind })) },
    unusedChannels: unused,
    budget: { month: input.budget.month, capCents: input.budget.capCents, remainingCents: input.budget.remainingCents },
  }
}

// ───────────────────────── rule text (pure) ─────────────────────────

export interface Rec {
  kind: string
  title: string
  body: string
  data: Record<string, unknown>
}

/** One plain recommendation per fact that has something to say. All numbers here come from the facts. */
export function ruleRecommendations(f: Facts): Rec[] {
  const out: Rec[] = []
  const win = `in the last ${WINDOW_DAYS} days`
  if (f.postCount === 0) {
    out.push({ kind: 'no_data', title: 'Nothing to learn from yet', body: `No posts have gone out ${win}, so there is nothing to compare. Publish a few posts and sync the results, then ask again.`, data: { window: f.window } })
  }
  if (f.bestChannel) {
    const c = f.bestChannel
    out.push({
      kind: 'best_channel', title: `${c.label} brings the most visitors`,
      body: `${c.label} sent ${plural(c.visits, 'visit')} and ${plural(c.enquiries, 'enquiry', 'enquiries')} from ${plural(c.posts, 'post')} ${win}. Put your next posts there first.`,
      data: { ...c },
    })
  }
  if (f.bestProduct) {
    const p = f.bestProduct
    out.push({
      kind: 'best_product', title: `${p.name} is your best piece to promote`,
      body: `Posts about ${p.name} brought ${plural(p.visits, 'visit')} and ${plural(p.enquiries, 'enquiry', 'enquiries')} ${win}. Post about it again, maybe with a new photo.`,
      data: { ...p },
    })
  }
  if (f.bestDay || f.bestHour) {
    const parts: string[] = []
    if (f.bestDay) parts.push(`${f.bestDay.day}s (${f.bestDay.avgVisits} visits per post)`)
    if (f.bestHour) parts.push(`around ${hourLabel(f.bestHour.hour)} Harare time (${f.bestHour.avgVisits} visits per post)`)
    out.push({
      kind: 'best_time', title: 'When your posts do best',
      body: `Your posts did best on ${parts.join(' and ')}. Try to schedule more posts then.`,
      data: { day: f.bestDay, hour: f.bestHour },
    })
  }
  if (f.postsWithNoVisits.count > 0) {
    const n = f.postsWithNoVisits.count
    const names = f.postsWithNoVisits.examples.map((e) => `"${e.title}" on ${e.channel}`).join(', ')
    out.push({
      kind: 'no_visits', title: `${plural(n, 'post')} got no visits`,
      body: `${plural(n, 'post')} had no visits at all, for example ${names}. Check the link works and try a stronger photo or first line.`,
      data: { ...f.postsWithNoVisits },
    })
  }
  if (f.unusedChannels.length > 0) {
    const names = f.unusedChannels.map((c) => c.label).join(', ')
    out.push({
      kind: 'unused_channels', title: 'Connected channels you have not used',
      body: `You have not posted ${win} on ${names}. These are already connected, so they cost nothing to try.`,
      data: { channels: f.unusedChannels },
    })
  }
  const b = f.budget
  if (b.capCents > 0) {
    out.push({
      kind: 'budget_left', title: `${money(b.remainingCents)} of ad budget left this month`,
      body: b.remainingCents > 0
        ? `Your ad limit for ${b.month} is ${money(b.capCents)} and ${money(b.remainingCents)} of it is not yet committed. Put it behind your best performing piece.`
        : `Your ad limit for ${b.month} is ${money(b.capCents)} and all of it is committed. Nothing more can be spent on ads this month.`,
      data: { ...b },
    })
  } else {
    out.push({
      kind: 'budget_left', title: 'No ad budget set',
      body: 'Your monthly ad limit is $0.00, so no ads can run. Set a limit in Settings if you want to try one.',
      data: { ...b },
    })
  }
  return out
}

// ───────────────────────── AI wording ─────────────────────────

const SYSTEM = `You help the owner of VYRA, a small children's boutique in Harare, understand last month's marketing. You are given short pieces of advice that were worked out by the shop's system. Rewrite each one in warm, plain, British English that a busy shopkeeper can act on in a minute.
Hard rules:
- Use ONLY numbers, names, days and times that appear in the piece you are rewriting. Never add, round, estimate or compare numbers yourself. Never mention a price, discount or stock level.
- Keep the same meaning and the same "kind". Do not add new advice items.
- title: at most 70 characters. body: at most 3 short sentences. No emojis, no jargon.
- Return only JSON.`

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { kind: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' } },
        required: ['kind', 'title', 'body'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
}

export interface RecommendAi {
  client?: Pick<Anthropic, 'messages'>
  openai?: Pick<OpenAI, 'responses'>
}

const numbersIn = (s: string) => (s.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => String(parseFloat(n.replace(/,/g, '')))).filter((n) => n !== 'NaN')

/** True when the AI text holds a number that is not in the rule text (so it was invented). */
export function inventsNumbers(ai: { title: string; body: string }, rule: { title: string; body: string }): boolean {
  const allowed = new Set([...numbersIn(`${rule.title} ${rule.body}`), '0'])
  return numbersIn(`${ai.title} ${ai.body}`).some((n) => !allowed.has(n))
}

/** Pure: merge the model's wording into the rule recommendations, keeping rule text wherever the model strayed. */
export function mergeAiWording(rules: Rec[], json: unknown): { recs: Rec[]; reworded: number } {
  const items = typeof json === 'object' && json !== null ? (json as { items?: unknown }).items : undefined
  if (!Array.isArray(items)) throw new Error('The AI reply was not in the expected shape')
  let reworded = 0
  const recs = rules.map((r) => {
    const m = items.find((i) => typeof i === 'object' && i !== null && (i as { kind?: unknown }).kind === r.kind) as { title?: unknown; body?: unknown } | undefined
    const title = typeof m?.title === 'string' ? m.title.trim() : ''
    const body = typeof m?.body === 'string' ? m.body.trim() : ''
    if (!title || !body || title.length > 120 || body.length > 600 || inventsNumbers({ title, body }, r) || /[$€£]\s?\d/.test(`${title} ${body}`) && !/[$€£]\s?\d/.test(`${r.title} ${r.body}`)) return r
    reworded++
    return { ...r, title, body }
  })
  return { recs, reworded }
}

export function aiAvailable(ai: RecommendAi = {}): boolean {
  return Boolean(ai.client || ai.openai || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY)
}

async function askModel(rules: Rec[], ai: RecommendAi): Promise<{ text: string; costCents: number }> {
  const prompt = `Rewrite these ${rules.length} pieces of advice as JSON.\n${JSON.stringify(rules.map((r) => ({ kind: r.kind, title: r.title, body: r.body })))}`
  const hasClaude = Boolean(ai.client || process.env.ANTHROPIC_API_KEY)
  const hasOpenAI = Boolean(ai.openai || process.env.OPENAI_API_KEY)
  const viaOpenAI = async () => {
    const res = await (ai.openai ?? new OpenAI({ maxRetries: 2 })).responses.create({
      model: OPENAI_LISTING_MODEL, instructions: SYSTEM, reasoning: { effort: 'low' },
      input: [{ role: 'user', content: [{ type: 'input_text' as const, text: prompt }] }],
      text: { format: { type: 'json_schema', name: 'marketing_advice', schema: SCHEMA, strict: true } },
    })
    if (!res.output_text) throw new Error('The AI returned no text')
    const u = res.usage
    return { text: res.output_text, costCents: Math.ceil((u?.input_tokens ?? 0) * GPT.input + (u?.output_tokens ?? 0) * GPT.output) }
  }
  if (hasClaude) {
    try {
      const msg = await (ai.client ?? new Anthropic()).messages.create({
        model: process.env.ANTHROPIC_MARKETING_MODEL || process.env.ANTHROPIC_LISTING_MODEL || 'claude-opus-5-5',
        max_tokens: 3000, system: SYSTEM,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{ role: 'user', content: [{ type: 'text' as const, text: prompt }] }],
      })
      if (msg.stop_reason === 'refusal') throw new Error('The AI declined to write this advice')
      const block = msg.content.find((b) => b.type === 'text')
      if (!block || block.type !== 'text') throw new Error('The AI returned no text')
      return { text: block.text, costCents: Math.ceil(msg.usage.input_tokens * CLAUDE.input + msg.usage.output_tokens * CLAUDE.output) }
    } catch (error) {
      if (!hasOpenAI || !(error instanceof Anthropic.APIError)) throw error
      return viaOpenAI()
    }
  }
  return viaOpenAI()
}

// ───────────────────────── collect, generate, list, update ─────────────────────────

/** The Monday (Harare) of the week containing `now`, as a Date at UTC midnight. */
export function weekOf(now: Date): Date {
  const idx = Math.floor((now.getTime() + HARARE_MS) / DAY_MS)
  const dow = new Date(idx * DAY_MS).getUTCDay() // 0 = Sunday
  return new Date((idx - ((dow + 6) % 7)) * DAY_MS)
}

export async function collectFacts(db: Db, now: Date): Promise<Facts> {
  const to = hararedayString(now)
  const from = ymd(new Date(new Date(`${to}T00:00:00.000Z`).getTime() - (WINDOW_DAYS - 1) * DAY_MS))
  const report = await resultsReport(db, { from, to })
  const rows = await db.marketingPost.findMany({
    where: { status: { in: ['PUBLISHED', 'SHARED'] }, publishedAt: { gte: new Date(`${from}T00:00:00.000Z`) } },
    include: { content: { select: { title: true, productId: true, product: { select: { productName: true, publicName: true } } } } },
  })
  const byPost = new Map(report.perPost.map((p) => [p.postId, p]))
  const settings = await getSettings(db)
  const budget = await budgetSummary(db, settings, now)
  const connected = await db.marketingChannel.findMany({ where: { status: 'CONNECTED', kind: { not: 'META_ADS' } }, select: { kind: true } })
  const kinds = [...new Set(connected.map((c) => c.kind))]
  const used = new Set(rows.map((r) => r.channelKind))
  return computeFacts({
    from, to, now,
    posts: rows.map((p) => ({
      postId: p.id, title: p.content.title, channelKind: p.channelKind, productId: p.content.productId,
      productName: p.content.product ? p.content.product.publicName?.trim() || p.content.product.productName : null,
      publishedAt: p.publishedAt, visits: byPost.get(p.id)?.visits ?? 0, enquiries: byPost.get(p.id)?.enquiries ?? 0,
    })),
    channels: kinds.map((kind) => ({ kind, postsInWindow: used.has(kind) ? 1 : 0 })),
    budget,
  })
}

export interface GenerateResult {
  weekOf: string
  recommendations: MarketingRecommendation[]
  usedAi: boolean
  aiError: string | null
  costCents: number
}

/**
 * Work out this week's advice and save it. Re-running replaces the week's NEW items; items already marked
 * DONE or DISMISSED are kept and not repeated. Works without AI (rule text).
 */
export async function generateRecommendations(db: Db, actorIn: Actor | string, opts: { now?: Date; ai?: RecommendAi; useAi?: boolean } = {}): Promise<GenerateResult> {
  const actor = typeof actorIn === 'string' ? actorIn : actorIn.username
  const now = opts.now ?? new Date()
  const facts = await collectFacts(db, now)
  let recs = ruleRecommendations(facts)
  let usedAi = false
  let aiError: string | null = null
  let costCents = 0
  if ((opts.useAi ?? true) && aiAvailable(opts.ai) && recs.length > 0) {
    try {
      const raw = await askModel(recs, opts.ai ?? {})
      costCents = raw.costCents
      let json: unknown
      try { json = JSON.parse(raw.text) } catch { throw new Error('The AI reply was not valid JSON') }
      const merged = mergeAiWording(recs, json)
      recs = merged.recs
      usedAi = merged.reworded > 0
    } catch (e) {
      aiError = e instanceof Error ? e.message : 'The AI could not write the advice.'
    }
  }
  const week = weekOf(now)
  const kept = await db.marketingRecommendation.findMany({ where: { weekOf: week, status: { in: ['DONE', 'DISMISSED'] } }, select: { kind: true } })
  const keptKinds = new Set(kept.map((k) => k.kind))
  const fresh = recs.filter((r) => !keptKinds.has(r.kind))
  const removed = await db.marketingRecommendation.deleteMany({ where: { weekOf: week, status: 'NEW' } })
  const saved: MarketingRecommendation[] = []
  for (const [i, r] of fresh.entries()) {
    saved.push(await db.marketingRecommendation.create({
      data: { weekOf: week, kind: r.kind, title: r.title, body: r.body, data: r.data as never, status: 'NEW', aiCostCents: i === 0 ? costCents : 0 },
    }))
  }
  await writeAudit(db, { actor, action: 'recommendations.generate', entity: 'recommendation', detail: { weekOf: ymd(week), created: saved.length, replaced: removed.count, usedAi, costCents, aiError } })
  return { weekOf: ymd(week), recommendations: saved, usedAi, aiError, costCents }
}

export async function listRecommendations(db: Db, f: { weekOf?: Date | null; status?: string | null } = {}) {
  const where: { weekOf?: Date; status?: string } = {}
  if (f.weekOf) where.weekOf = f.weekOf
  if (f.status) where.status = f.status
  return db.marketingRecommendation.findMany({ where, orderBy: [{ weekOf: 'desc' }, { id: 'asc' }], take: 200 })
}

/** Mark advice DONE or DISMISSED (or back to NEW). Compare-and-set on the old status; audited. */
export async function setRecommendationStatus(db: Db, id: number, status: unknown, actorIn: Actor | string): Promise<MarketingRecommendation> {
  const actor = typeof actorIn === 'string' ? actorIn : actorIn.username
  if (typeof status !== 'string' || !(RECOMMENDATION_STATUSES as readonly string[]).includes(status)) {
    throw new WebsiteError(400, 'The status must be NEW, DONE or DISMISSED.', { field: 'status' })
  }
  const rec = await db.marketingRecommendation.findUnique({ where: { id } })
  if (!rec) throw new WebsiteError(404, 'Advice not found')
  if (rec.status === status) return rec
  const res = await db.marketingRecommendation.updateMany({ where: { id, status: rec.status }, data: { status } })
  if (res.count === 0) throw new WebsiteError(409, 'Someone else just changed this. Reload and try again.')
  await writeAudit(db, { actor, action: 'recommendation.status', entity: 'recommendation', entityId: id, detail: { from: rec.status, to: status } })
  return (await db.marketingRecommendation.findUnique({ where: { id } }))!
}
