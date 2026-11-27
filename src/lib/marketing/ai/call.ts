// VYRA Marketing hub: one JSON answer from the AI. Server only.
// Claude when ANTHROPIC_API_KEY is set, OpenAI as the fallback (same as the listing writer).
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { OPENAI_LISTING_MODEL } from '@/lib/ai/listing-text'

// Estimated pricing in cents per token (same figures as src/lib/ai/listing-text.ts).
const CLAUDE = { input: 400 / 1_000_000, output: 2000 / 1_000_000 }
const GPT = { input: 800 / 1_000_000, output: 4000 / 1_000_000 }

export type AiFns = { client?: Pick<Anthropic, 'messages'>; openai?: Pick<OpenAI, 'responses'> }
export interface AiCall {
  system: string
  prompt: string
  schema: Record<string, unknown>
  /** Schema name for OpenAI. */
  name: string
  maxTokens?: number
  /** Shown when the model declines, e.g. "write this post". */
  task: string
}
export interface AiAnswer {
  text: string
  costCents: number
  writer: 'claude' | 'openai'
}

export const hasAiKey = (fns: AiFns = {}) => ({
  claude: Boolean(fns.client || process.env.ANTHROPIC_API_KEY),
  openai: Boolean(fns.openai || process.env.OPENAI_API_KEY),
})

/** Claude first; OpenAI when there is no Claude key or the Claude call fails (for example out of credit). */
export async function callJson(call: AiCall, fns: AiFns = {}): Promise<AiAnswer> {
  const has = hasAiKey(fns)
  if (!has.claude && !has.openai) throw new Error('No AI key is set up for the marketing writer')
  if (has.claude) {
    try {
      return await withClaude(call, fns.client ?? new Anthropic())
    } catch (error) {
      if (!has.openai || !(error instanceof Anthropic.APIError)) throw error
      console.warn('[marketing] Claude call failed, using OpenAI:', error.status, error.message)
    }
  }
  return withOpenAI(call, fns.openai ?? new OpenAI({ maxRetries: 2 }))
}

async function withClaude(call: AiCall, client: Pick<Anthropic, 'messages'>): Promise<AiAnswer> {
  const msg = await client.messages.create({
    model: process.env.ANTHROPIC_MARKETING_MODEL || process.env.ANTHROPIC_LISTING_MODEL || 'claude-opus-5-5',
    max_tokens: call.maxTokens ?? 4000,
    system: call.system,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: call.schema } },
    messages: [{ role: 'user', content: [{ type: 'text' as const, text: call.prompt }] }],
  })
  if (msg.stop_reason === 'refusal') throw new Error(`The AI declined to ${call.task}`)
  const block = msg.content.find((b) => b.type === 'text')
  if (!block || block.type !== 'text') throw new Error('The AI returned no text')
  const costCents = Math.ceil(msg.usage.input_tokens * CLAUDE.input + msg.usage.output_tokens * CLAUDE.output)
  return { text: block.text, costCents, writer: 'claude' }
}

async function withOpenAI(call: AiCall, client: Pick<OpenAI, 'responses'>): Promise<AiAnswer> {
  const res = await client.responses.create({
    model: OPENAI_LISTING_MODEL,
    instructions: call.system,
    reasoning: { effort: 'low' },
    input: [{ role: 'user', content: [{ type: 'input_text' as const, text: call.prompt }] }],
    text: { format: { type: 'json_schema', name: call.name, schema: call.schema, strict: true } },
  })
  const refused = res.output.some((o) => o.type === 'message' && o.content.some((c) => c.type === 'refusal'))
  if (refused) throw new Error(`The AI declined to ${call.task}`)
  if (!res.output_text) throw new Error('The AI returned no text')
  const u = res.usage
  const costCents = Math.ceil((u?.input_tokens ?? 0) * GPT.input + (u?.output_tokens ?? 0) * GPT.output)
  return { text: res.output_text, costCents, writer: 'openai' }
}
