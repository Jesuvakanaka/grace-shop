// VYRA Marketing hub (ZP-1200): broadcasts to opted-in contacts (email, SMS, WhatsApp templates). Server only.
// SAFETY: a message goes only to a contact whose LATEST consent for that exact channel is OPTED_IN, only through
// assertCanGoLive (env live + live setting + connected channel + OWNER approval), and never twice to one person
// (unique recipient row, claimed before the request). The recipient list is recomputed at send time and consent
// is checked again right before each message, so an opt-out during a send is honoured.
import { Prisma, type MarketingBroadcast, type MarketingChannel } from '@prisma/client'
import { hostRoutingConfigFromEnv } from '@/lib/host-routing'
import { WebsiteError } from '@/lib/website/http'
import { writeAudit, type Db } from './audit'
import { BROADCAST_OWNER_ACTIONS, BROADCAST_STATUSES, transitionBroadcast, type BroadcastAction, type BroadcastActor } from './broadcast-state'
import { getChannel } from './channels'
import { CONSENT_FOR_CHANNEL, addressFor, isOptedIn, CONTACT_SOURCES } from './consent'
import { PURPOSE_FOR_BROADCAST, stopEverything } from './consent-records'
import { getConnector } from './connectors'
import type { Connector, ConnectorMessage, FetchLike } from './connectors/types'
import { assertCanGoLive, checkCanGoLive, type GoLiveInput } from './flags'
import { publicOrigin } from './publish'
import { decryptJson } from './secrets'
import { getSettings } from './settings'
import { generateTrackingTag } from './tracking'
import { unsubscribeUrl } from './unsubscribe'
import { asObject, date, idList, onlyKeys, oneOf, requiredText, text } from './validate'

export const BROADCAST_CHANNELS = ['EMAIL', 'SMS', 'WHATSAPP_CLOUD'] as const
/** MM-12: what a message is for. Each needs its own consent purpose (PURPOSE_FOR_BROADCAST). */
export const BROADCAST_PURPOSES = ['PROMOTION', 'REVIEW_REQUEST'] as const

/** MM-12-AC3: the cost of `count` messages, or null when the channel's per-message cost is not known. Pure. */
export function estimateCostCents(count: number, channelKind: string, costs: unknown): number | null {
  const table = typeof costs === 'object' && costs !== null && !Array.isArray(costs) ? costs as Record<string, unknown> : {}
  const unit = table[channelKind]
  if (typeof unit !== 'number' || !Number.isFinite(unit) || unit < 0) return null
  return Math.round(count * unit)
}

// MM-12-AC5: a review request asks for an honest review. It never asks only for good ones, never offers anything
// for a review, and the shop never writes reviews itself.
const REVIEW_RULES: Array<[RegExp, string]> = [
  [/\b(5|five)[- ]?stars?\b|\b(positive|good|great|glowing|nice|excellent)\s+(review|rating|feedback)s?\b|\bonly (happy|satisfied)\b/i, 'Ask for an honest review, not a good one.'],
  [/\b(discount|voucher|coupon|gift|free|reward|prize|draw|entry|cash ?back|points)\b[^.?!]*\b(review|rating|feedback)\b|\b(review|rating|feedback)\b[^.?!]*\b(discount|voucher|coupon|gift|free|reward|prize|draw|entry|cash ?back|points)\b|%\s*off[^.?!]*\breview|\breview\b[^.?!]*%\s*off/i, 'A review request cannot offer anything in return for a review.'],
  [/\b(we|i)('ll| will| can)? (write|post|leave) (a|the|your) review\b|\breview (written|posted) (for|on behalf of) you\b/i, 'The shop never writes or posts reviews for customers.'],
]

/** Problems with a request for reviews or feedback (pure). Checked on every message, whatever its purpose. */
export function reviewRequestProblems(text: string): string[] {
  return REVIEW_RULES.filter(([re]) => re.test(text)).map(([, why]) => why)
}
export const MAX_PER_RUN = 500
export const DEFAULT_PER_SECOND = 1
/** Text limits: SMS leaves room for the "Reply STOP" line. */
export const BROADCAST_TEXT_MAX: Record<string, number> = { SMS: 290, WHATSAPP_CLOUD: 1024, EMAIL: 20000 }
/** A recipient still "being sent" after this long belongs to a run that crashed. */
const STUCK_AFTER_MS = 10 * 60 * 1000
const UNSURE = 'Not sure whether this was sent. Check your provider before sending it again.'

export interface AudienceFilter { sources?: string[]; contactIds?: number[] }

export interface BroadcastDeps {
  fetch: FetchLike
  baseUrl?: string | null
  getConnector?: (kind: string) => Connector | undefined
  /** Waits between messages. Tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>
  env?: Record<string, string | undefined>
  now?: () => Date
}

export const SYSTEM: BroadcastActor = { username: 'system', role: 'SYSTEM' }
const asActor = (a: BroadcastActor | string): BroadcastActor => (typeof a === 'string' ? { username: a, role: 'OWNER' } : a)
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Messages per second: env GRACE_MARKETING_SEND_PER_SECOND (default 1; fractions such as 0.5 allowed; at most 10). */
export function sendRatePerSecond(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.GRACE_MARKETING_SEND_PER_SECOND)
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10) : DEFAULT_PER_SECOND
}

/** The start of the current day in Harare (UTC+2, no daylight saving), as a UTC Date. */
export function harareDayStart(now: Date): Date {
  const local = new Date(now.getTime() + 2 * 3_600_000)
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - 2 * 3_600_000)
}

// ---------------------------------------------------------------- links and personalisation

/** Adds ?src=<tag> to every link to our own shop that has none, so results can be counted. Other links are left alone. */
export function tagLinks(body: string, tag: string, storefrontHosts: readonly string[]): string {
  const hosts = storefrontHosts.map((h) => h.toLowerCase().replace(/:\d+$/, ''))
  return body.replace(/https?:\/\/[^\s<>"')]+/g, (raw) => {
    const trail = raw.match(/[.,;:!?]+$/)?.[0] ?? ''
    const link = trail ? raw.slice(0, -trail.length) : raw
    try {
      const u = new URL(link)
      if (!hosts.includes(u.hostname.toLowerCase()) || u.searchParams.has('src')) return raw
      u.searchParams.set('src', tag)
      return u.toString() + trail
    } catch {
      return raw
    }
  })
}

const firstName = (name: string | null) => (name ?? '').trim().split(/\s+/)[0] || 'there'
const personalise = (s: string, name: string | null) => s.replace(/\{name\}/gi, firstName(name))

// ---------------------------------------------------------------- audience

export function parseFilter(v: unknown): AudienceFilter {
  if (v === undefined || v === null) return {}
  const o = asObject(v)
  onlyKeys(o, ['sources', 'contactIds'])
  const f: AudienceFilter = {}
  if ('sources' in o) {
    if (!Array.isArray(o.sources) || o.sources.length > 4) throw new WebsiteError(400, 'sources must be a list of sources.', { field: 'audienceFilter' })
    f.sources = [...new Set(o.sources.map((s) => oneOf(s, 'sources', CONTACT_SOURCES)))]
  }
  if ('contactIds' in o) f.contactIds = idList(o.contactIds, 'contactIds', 2000)
  return f
}

export interface AudienceMember { id: number; name: string | null; address: string }
export interface AudienceSummary {
  /** Contacts who may be messaged right now. */
  eligible: AudienceMember[]
  /** Everyone the filter matches. */
  matched: number
  /** Left out and why. */
  withheld: { noAddress: number; noConsent: number; optedOut: number }
}

/** The recipients as of now: latest consent for exactly this channel is OPTED_IN, and the contact has an address. */
export async function computeAudience(db: Db, b: { channelKind: string; audienceFilter: unknown; purpose?: string }): Promise<AudienceSummary> {
  const consentChannel = CONSENT_FOR_CHANNEL[b.channelKind]
  if (!consentChannel) throw new WebsiteError(400, 'This channel cannot send messages to contacts.')
  // MM-12-AC2: only a recorded opt-in for this exact channel AND purpose counts. Buying or a group never does.
  const purpose = PURPOSE_FOR_BROADCAST[b.purpose ?? 'PROMOTION'] ?? 'PROMOTION'
  const f = parseFilter(b.audienceFilter)
  const where: Prisma.MarketingContactWhereInput = { shopKey: 'vyra' }
  if (f.sources?.length) where.source = { in: f.sources }
  if (f.contactIds?.length) where.id = { in: f.contactIds }
  const contacts = await db.marketingContact.findMany({ where, include: { consents: { where: { channel: consentChannel } } }, orderBy: { id: 'asc' } })
  const out: AudienceSummary = { eligible: [], matched: contacts.length, withheld: { noAddress: 0, noConsent: 0, optedOut: 0 } }
  for (const c of contacts) {
    const address = addressFor(b.channelKind, c)
    if (!address) { out.withheld.noAddress++; continue }
    if (isOptedIn(c.consents, consentChannel, purpose)) { out.eligible.push({ id: c.id, name: c.name, address }); continue }
    if (c.consents.some((r) => (r.purpose || 'PROMOTION') === purpose)) out.withheld.optedOut++
    else out.withheld.noConsent++
  }
  return out
}

// ---------------------------------------------------------------- why a send is blocked

async function channelOf(db: Db, kind: string): Promise<MarketingChannel | null> {
  return db.marketingChannel.findFirst({ where: { kind, status: 'CONNECTED' }, orderBy: { id: 'asc' } })
}

/** Every go-live condition on its own, so the screen can list all that are missing, not just the first. */
export function allBlockers(g: GoLiveInput): string[] {
  const okSettings = { liveEnabled: true }
  const okChannel = { status: 'CONNECTED', credentialsEnc: 'x' }
  const okPost = { approvedBy: 'owner', approvedAt: new Date() }
  const okEnv = { GRACE_MARKETING_LIVE: 'true' }
  const probes: GoLiveInput[] = [
    { ...g, settings: okSettings, channel: okChannel, post: okPost },
    { ...g, env: okEnv, channel: okChannel, post: okPost },
    { ...g, env: okEnv, settings: okSettings, post: okPost },
    { ...g, env: okEnv, settings: okSettings, channel: okChannel },
  ]
  const reasons: string[] = []
  for (const p of probes) {
    const c = checkCanGoLive(p)
    if (!c.ok && !reasons.includes(c.reason)) reasons.push(c.reason)
  }
  return reasons
}

export type BroadcastDto = MarketingBroadcast & { templateVars: string[]; consentChannel: string }

const toDto = (b: MarketingBroadcast): BroadcastDto => ({
  ...b,
  templateVars: Array.isArray(b.templateVars) ? (b.templateVars as unknown[]).filter((x): x is string => typeof x === 'string') : [],
  consentChannel: CONSENT_FOR_CHANNEL[b.channelKind],
})

/** Problems with the words themselves (checked on submit and shown on the screen). */
export function contentProblems(b: { channelKind: string; text: string; subject: string | null; templateName: string | null; templateVars?: unknown }): string[] {
  const p: string[] = []
  const vars = Array.isArray(b.templateVars) ? b.templateVars.filter((v): v is string => typeof v === 'string').join('\n') : ''
  p.push(...reviewRequestProblems([b.subject ?? '', b.text, vars].join('\n')))
  if (!b.text.trim()) p.push('Write the words of the message.')
  if (b.channelKind === 'EMAIL' && !b.subject?.trim()) p.push('An email needs a subject.')
  if (b.channelKind === 'WHATSAPP_CLOUD' && !b.templateName) p.push('WhatsApp needs the name of a template that Meta has approved.')
  if (b.text.length > (BROADCAST_TEXT_MAX[b.channelKind] ?? 1000)) p.push(`This is too long for ${getChannel(b.channelKind)?.label ?? 'this channel'} (at most ${BROADCAST_TEXT_MAX[b.channelKind]} characters).`)
  return p
}

export interface BroadcastDetail {
  broadcast: BroadcastDto
  audience: { eligible: number; matched: number; withheld: AudienceSummary['withheld'] }
  /** Plain reasons a send would be refused right now. Empty means it can go. */
  blockedReasons: string[]
  /** The message as the first person would get it (links tagged). */
  preview: { text: string; subject: string | null }
  sentToday: number
  dailyCap: number
  /**
   * MM-12-AC3: what the owner approved, or null before approval. `willGet` is who a send reaches now: approved and
   * still eligible. `waitingForApproval` became eligible after approval and is left out until it is approved again.
   */
  approval: { count: number; costCents: number | null; criteria: unknown; purpose: string; willGet: number; waitingForApproval: number; noLongerEligible: number } | null
  /** The current estimate for everyone eligible now, or null when the per-message cost is not set. */
  estimatedCostCents: number | null
}

export async function getBroadcastDetail(db: Db, id: number, deps: Partial<BroadcastDeps> = {}): Promise<BroadcastDetail> {
  const b = await db.marketingBroadcast.findUnique({ where: { id } })
  if (!b) throw new WebsiteError(404, 'Message not found')
  const settings = await getSettings(db)
  const channel = await channelOf(db, b.channelKind)
  const aud = await computeAudience(db, b)
  const reasons = allBlockers({ settings, channel, post: b, env: deps.env })
  for (const r of contentProblems(b)) reasons.push(r)
  if (aud.eligible.length === 0) reasons.push('Nobody can be messaged yet: no contact has a recorded opt-in for this channel.')
  if (b.channelKind === 'EMAIL' && !publicOrigin({ fetch: async () => new Response(), baseUrl: deps.baseUrl })) reasons.push('The public site address is not set (GRACE_STOREFRONT_HOSTS), so the unsubscribe link cannot be made.')
  if (b.status !== 'APPROVED' && b.status !== 'SENDING' && b.status !== 'FAILED') reasons.push(`This message is ${b.status.toLowerCase().replace('_', ' ')}: it must be approved before it can be sent.`)
  const sentToday = await db.marketingBroadcastRecipient.count({ where: { status: 'SENT', sentAt: { gte: harareDayStart((deps.now ?? (() => new Date()))()) } } })
  if (settings.messageDailyCap <= sentToday) reasons.push(`The daily limit of ${settings.messageDailyCap} messages has been reached.`)
  const { hosts } = { hosts: hostRoutingConfigFromEnv().storefrontHosts }
  let approval: BroadcastDetail['approval'] = null
  if (b.approvedCount !== null && Array.isArray((b.approvedAudience as { contactIds?: unknown } | null)?.contactIds)) {
    const ok = new Set(approvedIds(b))
    const now = new Set(aud.eligible.map((m) => m.id))
    const willGet = [...now].filter((x) => ok.has(x)).length
    approval = {
      count: b.approvedCount, costCents: b.approvedCostCents, criteria: (b.approvedAudience as { criteria?: unknown }).criteria ?? null, purpose: b.purpose,
      willGet, waitingForApproval: now.size - willGet, noLongerEligible: ok.size - willGet,
    }
  }
  return {
    approval,
    estimatedCostCents: estimateCostCents(aud.eligible.length, b.channelKind, settings.messageCostCents),
    broadcast: toDto(b),
    audience: { eligible: aud.eligible.length, matched: aud.matched, withheld: aud.withheld },
    blockedReasons: reasons,
    preview: { text: personalise(tagLinks(b.text, b.trackingTag, hosts), aud.eligible[0]?.name ?? null), subject: b.subject },
    sentToday,
    dailyCap: settings.messageDailyCap,
  }
}

export async function listBroadcasts(db: Db): Promise<BroadcastDto[]> {
  const rows = await db.marketingBroadcast.findMany({ where: { shopKey: 'vyra' }, orderBy: { id: 'desc' }, take: 200 })
  return rows.map(toDto)
}

// ---------------------------------------------------------------- approval snapshot

const UNFREEZE = { approvedAudience: Prisma.DbNull, approvedCount: null, approvedCostCents: null } as const

/** The contact ids the owner approved this message for. */
export function approvedIds(b: { approvedAudience: unknown }): number[] {
  const ids = (b.approvedAudience as { contactIds?: unknown } | null)?.contactIds
  return Array.isArray(ids) ? ids.filter((x): x is number => Number.isInteger(x)) : []
}

// ---------------------------------------------------------------- create / edit

function parseFields(o: Record<string, unknown>, channelKind: string) {
  const d: Prisma.MarketingBroadcastUpdateInput = {}
  if ('name' in o) d.name = requiredText(o.name, 'name', 120)
  if ('subject' in o) d.subject = text(o.subject, 'subject', 200)
  if ('text' in o) {
    const t = requiredText(o.text, 'text', 20000)
    const max = BROADCAST_TEXT_MAX[channelKind]
    if (t.length > max) throw new WebsiteError(400, `This is too long for ${getChannel(channelKind)?.label} (at most ${max} characters, this has ${t.length}).`, { field: 'text' })
    d.text = t
  }
  if ('templateName' in o) {
    const n = text(o.templateName, 'templateName', 200)
    if (n !== null && !/^[a-z0-9_]{1,200}$/.test(n)) throw new WebsiteError(400, 'A WhatsApp template name uses lowercase letters, numbers and underscores only.', { field: 'templateName' })
    d.templateName = n
  }
  if ('templateLanguage' in o) {
    const l = requiredText(o.templateLanguage, 'templateLanguage', 12)
    if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(l)) throw new WebsiteError(400, 'The template language is a code such as en or en_GB.', { field: 'templateLanguage' })
    d.templateLanguage = l
  }
  if ('templateVars' in o) {
    if (!Array.isArray(o.templateVars) || o.templateVars.length > 10 || o.templateVars.some((v) => typeof v !== 'string' || v.length > 200)) {
      throw new WebsiteError(400, 'The template fields must be a list of up to 10 short texts.', { field: 'templateVars' })
    }
    d.templateVars = o.templateVars as string[]
  }
  if ('audienceFilter' in o) d.audienceFilter = parseFilter(o.audienceFilter) as Prisma.InputJsonValue
  if ('purpose' in o) d.purpose = oneOf(o.purpose, 'purpose', BROADCAST_PURPOSES)
  if ('scheduledFor' in o) d.scheduledFor = date(o.scheduledFor, 'scheduledFor')
  return d
}

export async function createBroadcast(db: Db, body: unknown, actor: string): Promise<BroadcastDto> {
  const o = asObject(body)
  onlyKeys(o, ['channelKind', 'name', 'subject', 'text', 'templateName', 'templateLanguage', 'templateVars', 'audienceFilter', 'purpose', 'scheduledFor'])
  const channelKind = oneOf(o.channelKind, 'channelKind', BROADCAST_CHANNELS)
  if (!('name' in o)) throw new WebsiteError(400, 'Give the message a name.', { field: 'name' })
  if (!('text' in o)) throw new WebsiteError(400, 'Write the words of the message.', { field: 'text' })
  const d = parseFields(o, channelKind)
  const b = await db.marketingBroadcast.create({
    data: { ...(d as Prisma.MarketingBroadcastCreateInput), channelKind, trackingTag: generateTrackingTag(), createdBy: actor },
  })
  await writeAudit(db, { actor, action: 'broadcast.create', entity: 'broadcast', entityId: b.id, detail: { channel: channelKind } })
  return toDto(b)
}

/** Edit a message. Changing anything after it was approved sends it back to DRAFT: approval is for the exact words. */
export async function updateBroadcast(db: Db, id: number, body: unknown, actorIn: BroadcastActor | string): Promise<BroadcastDto> {
  const actor = asActor(actorIn)
  const o = asObject(body)
  onlyKeys(o, ['name', 'subject', 'text', 'templateName', 'templateLanguage', 'templateVars', 'audienceFilter', 'purpose', 'scheduledFor'])
  const b = await db.marketingBroadcast.findUnique({ where: { id } })
  if (!b) throw new WebsiteError(404, 'Message not found')
  const d = parseFields(o, b.channelKind)
  if (Object.keys(d).length === 0) throw new WebsiteError(400, 'Nothing to change.')
  const t = transitionBroadcast(b, 'edit', actor) // 409 when it is already being sent or finished
  const res = await db.marketingBroadcast.updateMany({ where: { id, status: b.status }, data: { ...(d as Prisma.MarketingBroadcastUpdateManyMutationInput), ...t, ...UNFREEZE } })
  if (res.count === 0) throw new WebsiteError(409, 'Someone else just changed this. Reload and try again.')
  await writeAudit(db, { actor: actor.username, action: 'broadcast.edit', entity: 'broadcast', entityId: id, detail: { fields: Object.keys(d), from: b.status, to: t.status } })
  return toDto((await db.marketingBroadcast.findUnique({ where: { id } })) as MarketingBroadcast)
}

// ---------------------------------------------------------------- actions

export interface SendRun {
  sent: number
  failed: number
  skipped: number
  /** Why this run stopped before the list was done, in plain words. */
  stoppedBecause: string | null
}

export interface ActionResult { broadcast: BroadcastDto; run: SendRun | null }

const counts = async (db: Db, id: number) => {
  const g = await db.marketingBroadcastRecipient.groupBy({ by: ['status'], where: { broadcastId: id }, _count: { _all: true } })
  const n = (s: string) => g.find((x) => x.status === s)?._count._all ?? 0
  return { planned: g.reduce((a, x) => a + x._count._all, 0), sent: n('SENT'), failed: n('FAILED'), skipped: n('SKIPPED'), pending: n('PENDING'), sending: n('SENDING') }
}

async function syncCounts(db: Db, id: number) {
  const c = await counts(db, id)
  await db.marketingBroadcast.update({ where: { id }, data: { plannedCount: c.planned, sentCount: c.sent, failedCount: c.failed, skippedCount: c.skipped } })
  return c
}

/**
 * submit / approve / reject / cancel are plain status changes (audited). send / retry run the gate FIRST
 * (409, nothing changes, no request), then start sending a batch. Only OWNER actions come through the API.
 */
export async function broadcastAction(db: Db, id: number, action: string, actorIn: BroadcastActor | string, deps: BroadcastDeps, opts: { max?: number } = {}): Promise<ActionResult> {
  const actor = asActor(actorIn)
  if (!(BROADCAST_OWNER_ACTIONS as readonly string[]).includes(action)) throw new WebsiteError(400, 'Unknown action.', { field: 'action' })
  const b = await db.marketingBroadcast.findUnique({ where: { id } })
  if (!b) throw new WebsiteError(404, 'Message not found')
  if (action === 'send' || action === 'retry') return startSending(db, b, action, actor, deps, opts)
  if (action === 'submit' || action === 'approve') {
    const problems = contentProblems(b)
    if (problems.length > 0) throw new WebsiteError(409, problems[0])
  }
  const t = transitionBroadcast(b, action as BroadcastAction, actor)
  // MM-12-AC3: approval is for these people, these criteria and this cost. Anything else clears it.
  let frozen: Prisma.MarketingBroadcastUpdateManyMutationInput = UNFREEZE
  let approvalDetail: Record<string, unknown> = {}
  if (action === 'approve') {
    const aud = await computeAudience(db, b)
    const settings = await getSettings(db)
    const cost = estimateCostCents(aud.eligible.length, b.channelKind, settings.messageCostCents)
    frozen = {
      approvedAudience: { contactIds: aud.eligible.map((m) => m.id), criteria: parseFilter(b.audienceFilter), purpose: b.purpose, channelKind: b.channelKind } as unknown as Prisma.InputJsonValue,
      approvedCount: aud.eligible.length,
      approvedCostCents: cost,
    }
    approvalDetail = { count: aud.eligible.length, costCents: cost, criteria: parseFilter(b.audienceFilter), purpose: b.purpose }
  }
  const res = await db.marketingBroadcast.updateMany({ where: { id, status: b.status }, data: { ...t, ...(action === 'cancel' ? {} : frozen) } })
  if (res.count === 0) throw new WebsiteError(409, 'Someone else just changed this. Reload and try again.')
  await writeAudit(db, { actor: actor.username, action: `broadcast.${action}`, entity: 'broadcast', entityId: id, detail: { from: b.status, to: t.status, channel: b.channelKind, ...approvalDetail } })
  return { broadcast: toDto((await db.marketingBroadcast.findUnique({ where: { id } })) as MarketingBroadcast), run: null }
}

async function startSending(db: Db, b: MarketingBroadcast, action: 'send' | 'retry', actor: BroadcastActor, deps: BroadcastDeps, opts: { max?: number }): Promise<ActionResult> {
  const settings = await getSettings(db)
  const channel = await channelOf(db, b.channelKind)
  const t = transitionBroadcast(b, action, actor) // owner + status + approval, 409 before anything else
  assertCanGoLive({ settings, channel, post: b, env: deps.env }) // every condition, before any change or request
  if (action === 'send' && !Array.isArray((b.approvedAudience as { contactIds?: unknown } | null)?.contactIds)) {
    throw new WebsiteError(409, 'This message was approved before approvals listed the people it goes to. Submit and approve it again.')
  }
  const problems = contentProblems(b)
  if (problems.length > 0) throw new WebsiteError(409, problems[0])
  const res = await db.marketingBroadcast.updateMany({ where: { id: b.id, status: b.status }, data: { ...t } })
  if (res.count === 0) throw new WebsiteError(409, 'Someone else just changed this. Reload and try again.')
  await writeAudit(db, { actor: actor.username, action: `broadcast.${action}`, entity: 'broadcast', entityId: b.id, detail: { from: b.status, to: 'SENDING', channel: b.channelKind } })
  if (action === 'send') {
    // Recompute who may be messaged NOW. Rows that already exist are kept (nobody gets it twice).
    // MM-12-AC3: only people the owner approved, and only while they are still eligible. Newcomers wait for a new approval.
    const aud = await computeAudience(db, b)
    const approved = new Set(approvedIds(b))
    const go = aud.eligible.filter((m) => approved.has(m.id))
    await db.marketingBroadcastRecipient.createMany({ data: go.map((m) => ({ broadcastId: b.id, contactId: m.id })), skipDuplicates: true })
    await writeAudit(db, { actor: actor.username, action: 'broadcast.plan', entity: 'broadcast', entityId: b.id, detail: { eligible: go.length, matched: aud.matched, notApproved: aud.eligible.length - go.length, noLongerEligible: approved.size - go.length, ...aud.withheld } })
  } else {
    // Retry only the ones that failed with a known outcome. Anything of unknown outcome is never sent again.
    await db.marketingBroadcastRecipient.updateMany({ where: { broadcastId: b.id, status: 'FAILED', NOT: { error: { startsWith: 'Not sure' } } }, data: { status: 'PENDING', error: null } })
  }
  await syncCounts(db, b.id)
  return continueSending(db, b.id, actor, deps, opts)
}

/**
 * Send up to `max` (at most 500) more messages of a SENDING broadcast, one at a time, at the configured gentle rate.
 * Every message re-checks the gate and the person's latest consent first. Safe to call again and again.
 */
export async function continueSending(db: Db, id: number, actor: BroadcastActor, deps: BroadcastDeps, opts: { max?: number } = {}): Promise<ActionResult> {
  const max = Math.min(Math.max(Math.trunc(opts.max ?? MAX_PER_RUN) || MAX_PER_RUN, 1), MAX_PER_RUN)
  const sleep = deps.sleep ?? realSleep
  const now = deps.now ?? (() => new Date())
  const perMs = Math.round(1000 / sendRatePerSecond(deps.env ?? process.env))
  const run: SendRun = { sent: 0, failed: 0, skipped: 0, stoppedBecause: null }
  let b = await db.marketingBroadcast.findUnique({ where: { id } })
  if (!b) throw new WebsiteError(404, 'Message not found')
  if (b.status !== 'SENDING') throw new WebsiteError(409, 'This message is not being sent.')
  const consentChannel = CONSENT_FOR_CHANNEL[b.channelKind]
  const connector = (deps.getConnector ?? getConnector)(b.channelKind)
  if (!connector?.send) throw new WebsiteError(409, `${getChannel(b.channelKind)?.label ?? 'This channel'} cannot send messages yet.`)
  const origin = publicOrigin({ fetch: deps.fetch, baseUrl: deps.baseUrl })
  const hosts = hostRoutingConfigFromEnv().storefrontHosts
  let consecutiveBusy = 0
  let attempted = 0
  let sentToday = await db.marketingBroadcastRecipient.count({ where: { status: 'SENT', sentAt: { gte: harareDayStart(now()) } } })

  while (attempted < max) {
    // Fresh state every message: settings, channel and approval can change while a send is running.
    b = await db.marketingBroadcast.findUnique({ where: { id } })
    if (!b || b.status !== 'SENDING') { run.stoppedBecause = 'The message was stopped.'; break }
    const settings = await getSettings(db)
    const channel = await channelOf(db, b.channelKind)
    const gate: GoLiveInput = { settings, channel, post: b, env: deps.env }
    const check = checkCanGoLive(gate)
    if (!check.ok) { run.stoppedBecause = check.reason; break }
    if (sentToday >= settings.messageDailyCap) { run.stoppedBecause = `The daily limit of ${settings.messageDailyCap} messages has been reached. Sending carries on tomorrow.`; break }
    if (b.channelKind === 'EMAIL' && !origin) { run.stoppedBecause = 'The public site address is not set, so the unsubscribe link cannot be made.'; break }

    const next = await db.marketingBroadcastRecipient.findFirst({ where: { broadcastId: id, status: 'PENDING' }, orderBy: { id: 'asc' }, include: { contact: true } })
    if (!next) break
    // Claim it first: two runs can never send to the same person.
    const claim = await db.marketingBroadcastRecipient.updateMany({ where: { id: next.id, status: 'PENDING' }, data: { status: 'SENDING' } })
    if (claim.count === 0) continue

    const skip = async (why: string) => {
      await db.marketingBroadcastRecipient.update({ where: { id: next.id }, data: { status: 'SKIPPED', error: why } })
      run.skipped++
    }
    // MM-12-AC1: checked again right before each message, for this channel and this purpose, after the claim, so an
    // opt-out recorded while this run was picking the person is still seen.
    const consents = await db.marketingConsent.findMany({ where: { contactId: next.contact.id, channel: consentChannel } })
    if (!isOptedIn(consents, consentChannel, PURPOSE_FOR_BROADCAST[b.purpose] ?? 'PROMOTION')) { await skip('No longer opted in.'); continue }
    const address = addressFor(b.channelKind, next.contact)
    if (!address) { await skip('No address.'); continue }

    const msg: ConnectorMessage = {
      to: address,
      toName: next.contact.name,
      text: personalise(tagLinks(b.text, b.trackingTag, hosts), next.contact.name),
      subject: b.subject ? personalise(b.subject, next.contact.name) : null,
      templateName: b.templateName,
      templateLanguage: b.templateLanguage,
      templateVars: (Array.isArray(b.templateVars) ? (b.templateVars as unknown[]) : []).filter((v): v is string => typeof v === 'string').map((v) => personalise(tagLinks(v, b!.trackingTag, hosts), next.contact.name)),
      unsubscribeUrl: b.channelKind === 'EMAIL' && origin ? unsubscribeUrl(origin, next.contact.id, 'EMAIL') : null,
    }
    attempted++
    let result
    try {
      const credentials = decryptJson<Record<string, string>>((channel as MarketingChannel).credentialsEnc as string)
      result = await connector.send(msg, { credentials, externalId: (channel as MarketingChannel).externalId, config: ((channel as MarketingChannel).config as Record<string, unknown> | null) ?? null, fetch: deps.fetch, gate })
    } catch (e) {
      // The gate (or decryption) failed before a request: nothing was sent, put the person back.
      await db.marketingBroadcastRecipient.update({ where: { id: next.id }, data: { status: 'PENDING' } })
      run.stoppedBecause = e instanceof Error ? e.message : 'Sending stopped.'
      break
    }
    if (result.ok) {
      await db.marketingBroadcastRecipient.update({ where: { id: next.id }, data: { status: 'SENT', externalId: result.externalId, sentAt: now(), error: null } })
      run.sent++
      sentToday++
      consecutiveBusy = 0
    } else if (result.optedOut) {
      // MM-12: STOP stops every purpose on this channel, through the one consent writer (which also takes the person
      // off their other waiting messages).
      await stopEverything(db, next.contact.id, consentChannel, { method: 'The provider reported that this person replied STOP', recordedBy: 'system', via: 'provider STOP' })
      await skip('Replied STOP.')
    } else {
      await db.marketingBroadcastRecipient.update({ where: { id: next.id }, data: { status: 'FAILED', error: result.error.slice(0, 500) } })
      run.failed++
      consecutiveBusy = result.retryable ? consecutiveBusy + 1 : 0
      if (result.code === 401 && channel) {
        await db.marketingChannel.update({ where: { id: channel.id }, data: { status: 'ERROR', lastError: result.error.slice(0, 500) } })
        await writeAudit(db, { actor: 'system', action: 'channel.error', entity: 'channel', entityId: channel.id, detail: { code: 401 } })
        run.stoppedBecause = result.error
        break
      }
      if (consecutiveBusy >= 3) { run.stoppedBecause = `The provider keeps refusing messages for now: ${result.error}`; break }
    }
    await sleep(perMs)
  }

  const c = await syncCounts(db, id)
  // A row another run is sending right now must not be called "not sure": only rows stuck for a while (a crashed run).
  const inFlight = await db.marketingBroadcastRecipient.count({ where: { broadcastId: id, status: 'SENDING', updatedAt: { gte: new Date(now().getTime() - STUCK_AFTER_MS) } } })
  if (!run.stoppedBecause && c.pending === 0 && inFlight === 0) {
    // Done. Anything left "being sent" from a crashed run is NOT retried: we cannot tell if it went.
    await db.marketingBroadcastRecipient.updateMany({ where: { broadcastId: id, status: 'SENDING' }, data: { status: 'FAILED', error: UNSURE } })
    const c2 = await syncCounts(db, id)
    const cur = (await db.marketingBroadcast.findUnique({ where: { id } })) as MarketingBroadcast
    if (cur.status === 'SENDING') {
      const t = transitionBroadcast(cur, 'finish', SYSTEM, { failed: c2.failed > 0, error: c2.failed > 0 ? `${c2.failed} message${c2.failed === 1 ? '' : 's'} did not go out.` : null })
      await db.marketingBroadcast.updateMany({ where: { id, status: 'SENDING' }, data: { ...t } })
      await writeAudit(db, { actor: SYSTEM.username, action: 'broadcast.finish', entity: 'broadcast', entityId: id, detail: { to: t.status, sent: c2.sent, failed: c2.failed, skipped: c2.skipped } })
    }
  }
  await writeAudit(db, { actor: actor.username, action: 'broadcast.send_run', entity: 'broadcast', entityId: id, detail: { sent: run.sent, failed: run.failed, skipped: run.skipped, stoppedBecause: run.stoppedBecause } })
  return { broadcast: toDto((await db.marketingBroadcast.findUnique({ where: { id } })) as MarketingBroadcast), run }
}

export interface DueRun { started: number[]; continued: number[]; blocked: { id: number; reason: string }[] }

/** The runner: start APPROVED messages whose time has come and carry on with SENDING ones. Same gate as a button press. */
export async function runDueBroadcasts(db: Db, now: Date, deps: BroadcastDeps, opts: { max?: number } = {}): Promise<DueRun> {
  const out: DueRun = { started: [], continued: [], blocked: [] }
  const sending = await db.marketingBroadcast.findMany({ where: { status: 'SENDING' }, orderBy: { id: 'asc' } })
  const due = await db.marketingBroadcast.findMany({ where: { status: 'APPROVED', scheduledFor: { lte: now } }, orderBy: { id: 'asc' } })
  for (const b of [...sending, ...due]) {
    try {
      if (b.status === 'SENDING') { await continueSending(db, b.id, SYSTEM, { ...deps, now: () => now }, opts); out.continued.push(b.id) }
      else { await broadcastAction(db, b.id, 'send', SYSTEM, { ...deps, now: () => now }, opts); out.started.push(b.id) }
    } catch (e) {
      out.blocked.push({ id: b.id, reason: e instanceof Error ? e.message : 'Could not send.' })
    }
  }
  return out
}

export const BROADCAST_STATUS_LIST = BROADCAST_STATUSES
