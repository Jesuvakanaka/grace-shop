// VYRA Marketing hub: the second AI pass. It reads each draft against its brief, strictly,
// before the owner sees it. Server only. A failed draft is rewritten once by the writer.
import type { Job } from '../brief'
import { callJson, type AiFns } from './call'

export const QUESTIONS = ['READER', 'MESSAGE', 'SPECIFIC', 'PROOF', 'ACTION', 'TRUE'] as const
export type Question = (typeof QUESTIONS)[number]

export interface CheckInput {
  briefText: string
  factsText: string
  job: Job
  /** `short` marks a channel so small that only the opening and the action fit. */
  drafts: { channel: string; text: string; short?: boolean }[]
}
export interface CheckResult {
  /** Per channel: what to fix, one sentence each. A channel that passed is absent. */
  fixes: Record<string, string[]>
  costCents: number
}

export const CHECK_SYSTEM = `You are checking draft posts against their brief before the shop owner sees them. Be strict. For each draft, answer each question yes or no, and for every "no" give one short sentence saying what to fix.

1. READER: Does the first line speak to the reader named in the brief, in their moment?
2. MESSAGE: Does the post land the one message in the brief, and no second message?
3. SPECIFIC: Is every claim tied to something concrete, with no phrase that could describe any product?
4. PROOF: Is the proof from the brief stated plainly?
5. ACTION: Does the post end with the one action from the brief, and only that one?
6. TRUE: Does everything in the post come from the brief or the product facts?

The words {price}, {sizes} and {link} are placeholders the shop fills in with the real price, sizes and link. They are true by definition and are not a fault. A link or hashtags after the action do not count as a second action.

Return only JSON: for each draft its channel, and for each question its name, pass (true or false) and fix (a sentence, or null).`

const SCHEMA = {
  type: 'object',
  properties: {
    drafts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          channel: { type: 'string' },
          answers: {
            type: 'array',
            items: {
              type: 'object',
              properties: { question: { type: 'string', enum: [...QUESTIONS] }, pass: { type: 'boolean' }, fix: { type: ['string', 'null'] } },
              required: ['question', 'pass', 'fix'],
              additionalProperties: false,
            },
          },
        },
        required: ['channel', 'answers'],
        additionalProperties: false,
      },
    },
  },
  required: ['drafts'],
  additionalProperties: false,
}

/** Which questions apply: a "Get seen" piece needs no proof, and a very short channel keeps only the opening and the action. */
export function questionsFor(job: Job, short: boolean): Question[] {
  if (short) return ['READER', 'ACTION', 'TRUE']
  return job === 'GET_SEEN' ? QUESTIONS.filter((q) => q !== 'PROOF') : [...QUESTIONS]
}

/** Read the checker's JSON. Unknown channels and questions that do not apply are ignored. */
export function parseCheck(json: unknown, input: CheckInput): Record<string, string[]> {
  const rows = typeof json === 'object' && json !== null ? (json as { drafts?: unknown }).drafts : undefined
  if (!Array.isArray(rows)) throw new Error('The AI check was not in the expected shape')
  const fixes: Record<string, string[]> = {}
  for (const raw of rows) {
    if (typeof raw !== 'object' || raw === null) continue
    const r = raw as { channel?: unknown; answers?: unknown }
    const draft = input.drafts.find((d) => d.channel === r.channel)
    if (!draft || !Array.isArray(r.answers)) continue
    const applies = questionsFor(input.job, Boolean(draft.short))
    const list: string[] = []
    for (const a of r.answers) {
      if (typeof a !== 'object' || a === null) continue
      const { question, pass, fix } = a as { question?: unknown; pass?: unknown; fix?: unknown }
      if (pass !== false || !applies.includes(question as Question)) continue
      const t = typeof fix === 'string' ? fix.replace(/\s+/g, ' ').trim().slice(0, 240) : ''
      if (t) list.push(t)
    }
    if (list.length > 0) fixes[draft.channel] = list
  }
  return fixes
}

export async function checkDrafts(input: CheckInput, fns: AiFns = {}): Promise<CheckResult> {
  const prompt = [
    input.briefText,
    '',
    input.factsText,
    '',
    'Drafts to check:',
    ...input.drafts.flatMap((d) => [
      `--- ${d.channel}${d.short ? ' (a very short channel: only READER, ACTION and TRUE apply; answer pass for the others)' : ''}${input.job === 'GET_SEEN' ? ' (a GET SEEN piece needs no proof: answer pass for PROOF)' : ''} ---`,
      d.text,
    ]),
    '',
    'Check each draft and answer as JSON.',
  ].join('\n')
  const raw = await callJson({ system: CHECK_SYSTEM, prompt, schema: SCHEMA, name: 'draft_check', maxTokens: 2000, task: 'check these drafts' }, fns)
  let json: unknown
  try {
    json = JSON.parse(raw.text)
  } catch {
    throw new Error('The AI check was not valid JSON')
  }
  return { fixes: parseCheck(json, input), costCents: raw.costCents }
}
