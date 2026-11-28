// VYRA Marketing hub (ZP-1200): AI ad copy for Meta ads. Server only.
// Rule 3: the AI never invents prices, sizes or stock. The model gets the product's name, description and category
// only (no price, no sizes, no quantity) and is told to write none; copy that still contains a digit or "$" is
// refused, so nothing numeric the owner did not write can reach an ad.
// ZP-1106 (MM-01-AC2/AC4): the ad's product must be marketable (not withdrawn, not sold out), the model gets the
// product's truth (availability, known policies, wholesale) as plain lines, and copy that claims an unknown delivery
// or returns policy, stock on a pre-order, or wholesale terms the shop does not offer is refused (truthProblems).
// NOTE: a general channel writer (ai/writer.ts) is being built separately; when it lands, point generate() at it.
import Anthropic from '@anthropic-ai/sdk'
import type { MarketingAd } from '@prisma/client'
import { WebsiteError } from '@/lib/website/http'
import { writeAudit, type Db } from '../audit'
import { productTruth } from '../catalogue'
import { availabilityLine, shopTruth, truthProblems, type Availability, type TruthFacts } from '../product-truth'
import { getSettings } from '../settings'
import { shopIdentity, type ShopIdentity } from './shop'

export interface AdCopyInput {
  objective: string
  productName: string | null
  productDescription: string | null
  categoryName: string | null
  brief: string | null
  brandVoice: string | null
  /** Who the shop is, from settings (never hardcoded). */
  shop: ShopIdentity
  /** Where the shop sells, only when the owner set it. */
  market: string | null
  /** What may truthfully be said (adTruthLines). */
  truth: string[]
}
export interface AdCopy { headline: string; primaryText: string; description: string | null }
export type AdCopyGenerator = (input: AdCopyInput) => Promise<{ copy: AdCopy; costCents: number }>

const CLAUDE = { input: 400 / 1_000_000, output: 2000 / 1_000_000 }
/** The system prompt: the shop as the owner describes it, and the market only when the owner set one. Pure. */
export function adSystemPrompt(shop: ShopIdentity, market: string | null): string {
  const where = market?.trim() ? ` in ${market.trim()}` : ''
  return `You write short Facebook and Instagram ad copy for ${shop.name}, ${shop.description}${where}, in warm British English.
Rules: no prices, no sizes, no stock levels, no numbers at all, no discounts, no claims you cannot see in the details given. No emojis in the headline.
Follow the "Truth" lines exactly: never mention anything they say is not known or not offered.
headline: at most 40 characters. primaryText: at most 125 characters, one or two short sentences. description: at most 30 characters, or empty.
For a click to WhatsApp ad, invite the customer to message ${shop.name}.`
}

/** Ads never carry numbers, so availability is said without dates, and wholesale without terms. Pure. */
export function adTruthLines(facts: TruthFacts, policies: { delivery?: string | null; returns?: string | null }): string[] {
  const a: Availability | null = facts.availability
  const lines: string[] = []
  if (a?.kind === 'PRE_ORDER') lines.push('Availability: on pre-order, not in stock yet. Say it is on pre-order; never give a date.')
  else if (a) lines.push(`Availability: ${availabilityLine(a)}`)
  lines.push(facts.deliveryKnown ? `Delivery (the shop's own words): ${policies.delivery!.trim()}` : 'Delivery: NOT KNOWN. Never mention delivery, shipping or couriers.')
  lines.push(facts.returnsKnown ? `Returns (the shop's own words): ${policies.returns!.trim()}` : 'Returns: NOT KNOWN. Never mention returns, exchanges or refunds.')
  lines.push(facts.wholesale.ok
    ? 'Wholesale: this piece is also sold wholesale. You may say so, but never give wholesale terms.'
    : 'Wholesale: NOT OFFERED. Never mention wholesale, bulk or trade buying.')
  return lines
}

/** The truth check on the whole ad (headline, text, description). `allowed` is what the owner wrote. Pure. */
export function adTruthProblems(c: AdCopy, facts: TruthFacts, allowed = ''): string[] {
  return truthProblems([c.headline, c.primaryText, c.description ?? ''].join('\n'), facts, allowed)
}

const SCHEMA = {
  type: 'object',
  properties: { headline: { type: 'string' }, primaryText: { type: 'string' }, description: { type: 'string' } },
  required: ['headline', 'primaryText', 'description'],
  additionalProperties: false,
}

export const defaultGenerator: AdCopyGenerator = async (input) => {
  if (!process.env.ANTHROPIC_API_KEY) throw new WebsiteError(503, 'No AI key is set up for ad copy.')
  const client = new Anthropic()
  const lines = [
    `Objective: ${input.objective}.`,
    input.productName ? `Product: ${input.productName}.` : '',
    input.categoryName ? `Category: ${input.categoryName}.` : '',
    input.productDescription ? `Details: ${input.productDescription}` : '',
    input.brief ? `Owner's brief: ${input.brief}` : '',
    input.brandVoice ? `Brand voice: ${input.brandVoice}` : '',
    ...input.truth.map((l) => `Truth: ${l}`),
    'Write the ad copy as JSON.',
  ].filter(Boolean)
  const msg = await client.messages.create({
    model: process.env.ANTHROPIC_LISTING_MODEL || 'claude-opus-5-5',
    max_tokens: 1000,
    system: adSystemPrompt(input.shop, input.market),
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: lines.join('\n') }],
  })
  const block = msg.content.find((b) => b.type === 'text')
  if (!block || block.type !== 'text') throw new WebsiteError(502, 'The AI returned no ad copy.')
  let json: Record<string, unknown>
  try { json = JSON.parse(block.text) } catch { throw new WebsiteError(502, 'The AI ad copy was not valid.') }
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  return {
    copy: { headline: s(json.headline), primaryText: s(json.primaryText), description: s(json.description) || null },
    costCents: Math.ceil(msg.usage.input_tokens * CLAUDE.input + msg.usage.output_tokens * CLAUDE.output),
  }
}

/** Throws when the copy is empty, too long, or carries a number or currency sign the AI must not write. */
export function validateAdCopy(c: AdCopy): AdCopy {
  const all = [c.headline, c.primaryText, c.description ?? '']
  if (!c.headline || !c.primaryText) throw new WebsiteError(502, 'The AI did not write a headline and text. Try again.')
  if (all.some((t) => /\{\w+\}/.test(t))) throw new WebsiteError(502, 'The AI left a placeholder in the copy. Try again.')
  if (all.some((t) => /[\d$€£%]|\busd\b/i.test(t))) {
    throw new WebsiteError(502, 'The AI wrote a number or price, which ads must not contain unless you type it. Try again.')
  }
  if (c.headline.length > 80 || c.primaryText.length > 500 || (c.description?.length ?? 0) > 150) throw new WebsiteError(502, 'The AI copy was too long. Try again.')
  return c
}

/** Write headline, text and description into a DRAFT ad (never approves anything). */
export async function draftAdCopy(db: Db, adId: number, actor: string, generate: AdCopyGenerator = defaultGenerator): Promise<MarketingAd> {
  const ad = await db.marketingAd.findUnique({ where: { id: adId } })
  if (!ad) throw new WebsiteError(404, 'Ad not found')
  if (ad.status !== 'DRAFT') throw new WebsiteError(409, 'Only a draft ad can be rewritten.')
  const content = ad.contentId
    ? await db.marketingContent.findUnique({ where: { id: ad.contentId }, include: { product: { select: { id: true, publicName: true, productName: true, publicDescription: true, category: { select: { name: true } } } } } })
    : null
  const settings = await getSettings(db)
  const p = content?.product
  // MM-01-AC4: a withdrawn or sold-out piece is not advertised; nothing is generated (or paid for).
  const truth = p ? await productTruth(db, p.id) : null
  if (p && !truth) throw new WebsiteError(409, 'The product of this ad no longer exists, so no copy is written.', { blocked: 'product' })
  if (truth?.blockReason) throw new WebsiteError(409, truth.blockReason, { blocked: 'product' })
  const policies = { delivery: settings.policyDelivery, returns: settings.policyReturns, ordering: settings.policyOrdering }
  const facts = truth?.facts ?? shopTruth(policies).facts
  const { copy, costCents } = await generate({
    objective: ad.objective,
    productName: p ? p.publicName?.trim() || p.productName : content?.title ?? null,
    productDescription: p?.publicDescription ?? null,
    categoryName: p?.category?.name ?? null,
    brief: content?.brief ?? null,
    brandVoice: settings.brandVoice,
    shop: shopIdentity(settings),
    market: settings.market,
    truth: adTruthLines(facts, policies),
  })
  const c = validateAdCopy(copy)
  // MM-01-AC2: words the owner wrote (brief, brand voice, the product's own description) are not faults.
  const allowed = [content?.brief, settings.brandVoice, p?.publicDescription].filter(Boolean).join('\n')
  const problems = adTruthProblems(c, facts, allowed)
  if (problems.length > 0) {
    await writeAudit(db, { actor, action: 'ad.ai_draft_refused', entity: 'ad', entityId: adId, detail: { costCents, problems } })
    throw new WebsiteError(502, `The AI copy was thrown away: ${problems.join(' ')} Try again.`, { problems })
  }
  const row = await db.marketingAd.update({
    where: { id: adId },
    data: { headline: c.headline.slice(0, 80), primaryText: c.primaryText.slice(0, 500), description: c.description, aiGenerated: true, aiCostCents: { increment: costCents } },
  })
  await writeAudit(db, { actor, action: 'ad.ai_draft', entity: 'ad', entityId: adId, detail: { costCents } })
  return row
}
