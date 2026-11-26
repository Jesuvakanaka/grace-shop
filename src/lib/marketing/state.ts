// VYRA Marketing hub (ZP-1200): the post status machine. Pure, no database.
import { WebsiteError } from '@/lib/website/http'
import { getChannel } from './channels'

export const POST_STATUSES = [
  'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'SHARED', 'FAILED', 'REJECTED', 'CANCELLED',
] as const
export type PostStatus = (typeof POST_STATUSES)[number]

export const MAX_ATTEMPTS = 3

/** Actions the owner can ask for through the API. */
export const OWNER_ACTIONS = ['submit', 'cancel', 'approve', 'reject', 'schedule', 'unschedule', 'publish', 'retry', 'share'] as const
/** Actions only the runner / connector code takes. */
export const SYSTEM_ACTIONS = ['start', 'published', 'failed'] as const
/** `edit` is raised when the words, photos or format change. */
export type PostAction = (typeof OWNER_ACTIONS)[number] | (typeof SYSTEM_ACTIONS)[number] | 'edit'

export interface StatePost {
  status: string
  channelKind: string
  scheduledFor: Date | null
  approvedBy: string | null
  approvedAt: Date | null
  attempts: number
}

export interface Actor {
  username: string
  role: 'OWNER' | 'STAFF' | 'SYSTEM'
}

export interface TransitionOpts {
  scheduledFor?: Date | null
  externalId?: string | null
  externalUrl?: string | null
  error?: string | null
  now?: Date
}

/** The fields that change. `status` is always set. */
export interface TransitionResult {
  status: PostStatus
  scheduledFor?: Date | null
  approvedBy?: string | null
  approvedAt?: Date | null
  publishedAt?: Date | null
  attempts?: number
  externalId?: string | null
  externalUrl?: string | null
  error?: string | null
}

const conflict = (m: string) => new WebsiteError(409, m)

const LABEL: Record<string, string> = {
  DRAFT: 'a draft', PENDING_APPROVAL: 'waiting for approval', APPROVED: 'approved', SCHEDULED: 'scheduled',
  PUBLISHING: 'being published', PUBLISHED: 'published', SHARED: 'already shared', FAILED: 'failed',
  REJECTED: 'rejected', CANCELLED: 'cancelled',
}

function mustBe(post: StatePost, action: string, from: readonly PostStatus[]) {
  if (!(from as readonly string[]).includes(post.status)) {
    throw conflict(`Cannot ${action} this post: it is ${LABEL[post.status] ?? post.status.toLowerCase()}.`)
  }
}

function mustBeOwner(actor: Actor, what: string) {
  if (actor.role !== 'OWNER') throw conflict(`Only the owner can ${what}.`)
}

function apiChannel(post: StatePost, what: string) {
  const ch = getChannel(post.channelKind)
  if (!ch) throw conflict('This channel is not known.')
  if (ch.mode !== 'api' || !ch.capabilities.publish) {
    throw conflict(`${ch.label} has no automatic posting: ${what}`)
  }
  return ch
}

export function transition(post: StatePost, action: PostAction, actor: Actor, opts: TransitionOpts = {}): TransitionResult {
  const now = opts.now ?? new Date()
  switch (action) {
    case 'submit':
      mustBe(post, 'submit', ['DRAFT'])
      return { status: 'PENDING_APPROVAL' }
    case 'cancel':
      mustBe(post, 'cancel', ['DRAFT', 'APPROVED', 'SCHEDULED', 'FAILED'])
      return { status: 'CANCELLED', scheduledFor: null }
    case 'approve':
      mustBeOwner(actor, 'approve a post')
      mustBe(post, 'approve', ['PENDING_APPROVAL'])
      return { status: 'APPROVED', approvedBy: actor.username, approvedAt: now }
    case 'reject':
      mustBeOwner(actor, 'reject a post')
      mustBe(post, 'reject', ['PENDING_APPROVAL'])
      return { status: 'REJECTED', approvedBy: null, approvedAt: null }
    case 'edit': {
      // Approval is for the exact words: any edit goes back to a draft.
      mustBe(post, 'edit', ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED', 'REJECTED'])
      if (post.status === 'DRAFT') return { status: 'DRAFT' }
      return { status: 'DRAFT', approvedBy: null, approvedAt: null, scheduledFor: null }
    }
    case 'schedule': {
      mustBe(post, 'schedule', ['APPROVED'])
      const ch = apiChannel(post, 'it is shared by hand, not scheduled.')
      if (!ch.capabilities.schedule) throw conflict(`${ch.label} cannot be scheduled: publish it when it is due.`)
      const when = opts.scheduledFor
      if (!when || Number.isNaN(when.getTime())) throw conflict('Choose a date and time to schedule this post.')
      if (when.getTime() <= now.getTime()) throw conflict('Choose a time in the future.')
      return { status: 'SCHEDULED', scheduledFor: when }
    }
    case 'unschedule':
      mustBe(post, 'unschedule', ['SCHEDULED'])
      return { status: 'APPROVED', scheduledFor: null }
    case 'publish':
      mustBe(post, 'publish', ['APPROVED'])
      apiChannel(post, 'it is shared by hand. Use "Mark as shared" instead.')
      return { status: 'PUBLISHING', attempts: post.attempts + 1, error: null }
    case 'start': {
      mustBe(post, 'start', ['SCHEDULED'])
      apiChannel(post, 'it cannot be published automatically.')
      if (!post.scheduledFor || post.scheduledFor.getTime() > now.getTime()) throw conflict('This post is not due yet.')
      return { status: 'PUBLISHING', attempts: post.attempts + 1, error: null }
    }
    case 'retry':
      mustBe(post, 'retry', ['FAILED'])
      apiChannel(post, 'it cannot be published automatically.')
      if (post.attempts >= MAX_ATTEMPTS) throw conflict(`This post failed ${MAX_ATTEMPTS} times. Edit it or cancel it.`)
      return { status: 'PUBLISHING', attempts: post.attempts + 1, error: null }
    case 'published':
      mustBe(post, 'mark as published', ['PUBLISHING'])
      return { status: 'PUBLISHED', publishedAt: now, externalId: opts.externalId ?? null, externalUrl: opts.externalUrl ?? null, error: null }
    case 'failed':
      mustBe(post, 'mark as failed', ['PUBLISHING'])
      return { status: 'FAILED', error: (opts.error ?? 'Publishing failed.').slice(0, 500) }
    case 'share': {
      mustBeOwner(actor, 'mark a post as shared')
      mustBe(post, 'mark as shared', ['APPROVED'])
      const ch = getChannel(post.channelKind)
      if (!ch || ch.mode !== 'manual') throw conflict('This channel posts automatically: use Publish.')
      return { status: 'SHARED', publishedAt: now }
    }
    default:
      throw conflict('Unknown action.')
  }
}
