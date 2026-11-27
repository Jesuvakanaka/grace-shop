// VYRA Marketing hub: the selling profile prompt. Server only.
// Runs once per product and works out who buys it, why they want it and what makes them
// hesitate. Every writer prompt is then handed this thinking instead of guessing.
import { displayName } from '@/lib/storefront-model/rules'
import { callJson, type AiFns } from './call'
import { cleanProfile, type SellingProfile } from '../profile-model'
import type { ShopIdentity, ShopPolicies } from './shop'

export interface ProfileProduct {
  productName: string
  publicName?: string | null
  publicDescription?: string | null
  category?: string | null
  colours?: string | null
  sizes?: string | null
  fabric?: string | null
  care?: string | null
  fitNote?: string | null
}

export interface ProfileInput {
  product: ProfileProduct
  shop: ShopIdentity
  policies?: ShopPolicies
  brandVoice?: string | null
  /** Default "English (British spelling)". */
  language?: string | null
}

export interface ProfileResult {
  profile: SellingProfile
  costCents: number
  writer: 'claude' | 'openai'
}

const str = { type: 'string' }
const SCHEMA = {
  type: 'object',
  properties: {
    buyers: { type: 'array', items: { type: 'object', properties: { who: str, moment: str }, required: ['who', 'moment'], additionalProperties: false } },
    reasons: { type: 'array', items: { type: 'object', properties: { reason: str, fact: str }, required: ['reason', 'fact'], additionalProperties: false } },
    doubts: { type: 'array', items: { type: 'object', properties: { doubt: str, answer: str }, required: ['doubt', 'answer'], additionalProperties: false } },
    occasions: { type: 'array', items: str },
  },
  required: ['buyers', 'reasons', 'doubts', 'occasions'],
  additionalProperties: false,
}

export function profileSystem(shop: ShopIdentity, language: string): string {
  return `You are the marketing strategist for ${shop.name}, ${shop.description}. Before anything is written about a product, you work out why a real person would buy it. Your profile is the thinking that every post, ad and message about this product will be written from, so it must be specific to this product and true.

You are given the product's facts, and the shop's policies where they are on file. Work only from these.

Return four things.

1. BUYERS. Two or three kinds of people who would buy this product. For each: who they are in a few words, and the moment they are in when they would want it. A moment is a real situation, such as an event coming up, a season changing, a gift to find or a problem to solve. "Parents" is not a buyer. "A parent with a family wedding in three weeks and nothing that fits" is.

2. REASONS TO WANT IT. The three strongest reasons, strongest first. Write each as what the buyer gets, not what the product has. "Cotton lining" is a feature. "She can wear it all day without scratching or asking to change" is a reason. After each reason, name the product fact it rests on. If you cannot name a fact, it is not a reason: leave it out.

3. DOUBTS. The questions that stop people buying this kind of product, most common first, up to four. Think of fit, quality, price, delivery, returns and whether it suits the occasion. For each doubt, give the honest answer using only the facts and policies you were given. When you have nothing to answer it with, write ASK THE OWNER and do not guess.

4. OCCASIONS. The times of year, events or life moments when this product sells best, up to four.

Rules
- Use only what you are given. Never invent a fact, a customer, a review, a number or a policy.
- Never mention a price or a stock level.
- No general praise. A sentence that could be said of any product does not belong in the profile.
- Plain words, short lines, in ${language}.
- Return only JSON: buyers (each with who and moment), reasons (each with reason and fact), doubts (each with doubt and answer), occasions (a list of short phrases).`
}

export function profileUserText(input: ProfileInput): string {
  const p = input.product
  const facts = [`Name: ${displayName(p)}`]
  const add = (label: string, v: string | null | undefined) => { if (v?.trim()) facts.push(`${label}: ${v.trim()}`) }
  add('Category', p.category)
  add('Description', p.publicDescription)
  add('Colours', p.colours)
  facts.push(`Sizes on file: ${p.sizes?.trim() ? 'yes' : 'no'}`)
  add('Fabric', p.fabric)
  add('Care', p.care)
  add('Fit', p.fitNote)
  const pol: string[] = []
  const pl = input.policies ?? {}
  if (pl.delivery?.trim()) pol.push(`- Delivery: ${pl.delivery.trim()}`)
  if (pl.returns?.trim()) pol.push(`- Returns: ${pl.returns.trim()}`)
  if (pl.ordering?.trim()) pol.push(`- How to order: ${pl.ordering.trim()}`)
  const lines = ['Product facts (use only these):', ...facts.map((f) => `- ${f}`)]
  if (pol.length > 0) lines.push('Shop policies on file:', ...pol)
  else lines.push('No shop policies are on file.')
  if (input.brandVoice?.trim()) lines.push(`Owner's voice notes: ${input.brandVoice.trim()}`)
  lines.push('Write the selling profile as JSON.')
  return lines.join('\n')
}

/** Ask the AI for a product's selling profile. Throws when the answer is unusable. */
export async function writeProfile(input: ProfileInput, fns: AiFns = {}): Promise<ProfileResult> {
  const language = input.language?.trim() || 'English (British spelling)'
  const raw = await callJson(
    { system: profileSystem(input.shop, language), prompt: profileUserText(input), schema: SCHEMA, name: 'selling_profile', maxTokens: 3000, task: 'work out this selling profile' },
    fns,
  )
  let json: unknown
  try {
    json = JSON.parse(raw.text)
  } catch {
    throw new Error('The AI reply was not valid JSON')
  }
  const profile = cleanProfile(json)
  if (profile.buyers.length === 0 || profile.reasons.length === 0) throw new Error('The AI could not work out a selling profile from these product details')
  return { profile, costCents: raw.costCents, writer: raw.writer }
}
