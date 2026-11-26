// VYRA Marketing hub (ZP-1200): the ad status machine. Pure, no database. Same style as state.ts.
//
// DRAFT -> PENDING_APPROVAL (submit) | CANCELLED
// PENDING_APPROVAL -> APPROVED (approve, owner) | REJECTED (reject, owner) | DRAFT (edit)
// APPROVED -> CREATING (create_on_platform) | DRAFT (edit) | CANCELLED
// CREATING -> PAUSED_ON_PLATFORM (created: made on Meta as PAUSED) | FAILED (create_failed)
// PAUSED_ON_PLATFORM -> ACTIVE (start, owner: a separate action) | COMPLETED | CANCELLED
//                    (budget / end date edit: stays here, approval cleared, owner approves again)
// ACTIVE -> PAUSED_ON_PLATFORM (pause) | COMPLETED
// FAILED -> CREATING (create_on_platform again, still approved) | DRAFT (edit) | CANCELLED
// REJECTED -> DRAFT (edit) | CANCELLED
import { WebsiteError } from '@/lib/website/http'
import type { Actor } from './state'

export const AD_STATUSES = [
  'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'CREATING', 'PAUSED_ON_PLATFORM', 'ACTIVE', 'COMPLETED', 'FAILED', 'REJECTED', 'CANCELLED',
] as const
export type AdStatus = (typeof AD_STATUSES)[number]

export const AD_OWNER_ACTIONS = ['submit', 'approve', 'reject', 'create_on_platform', 'start', 'pause', 'cancel'] as const
export const AD_SYSTEM_ACTIONS = ['created', 'create_failed', 'complete'] as const
/** `edit` = any change before the ad exists on Meta. `edit_live` = budget or end date of an ad already on Meta. */
export type AdAction = (typeof AD_OWNER_ACTIONS)[number] | (typeof AD_SYSTEM_ACTIONS)[number] | 'edit' | 'edit_live'

export const AD_OBJECTIVES = ['TRAFFIC', 'ENGAGEMENT', 'CLICK_TO_WHATSAPP'] as const
export type AdObjective = (typeof AD_OBJECTIVES)[number]

export interface StateAd {
  status: string
  approvedBy: string | null
  approvedAt: Date | null
  externalAdId: string | null
}

export interface AdTransitionOpts {
  error?: string | null
  now?: Date
}

export interface AdTransitionResult {
  status: AdStatus
  approvedBy?: string | null
  approvedAt?: Date | null
  activatedBy?: string | null
  activatedAt?: Date | null
  error?: string | null
  /** Set when a half-created ad is reset: the ids from Meta no longer match the edited ad. */
  externalCampaignId?: null
  externalAdSetId?: null
  externalCreativeId?: null
  externalAdId?: null
}

const conflict = (m: string) => new WebsiteError(409, m)

const LABEL: Record<string, string> = {
  DRAFT: 'a draft', PENDING_APPROVAL: 'waiting for approval', APPROVED: 'approved', CREATING: 'being created on Meta',
  PAUSED_ON_PLATFORM: 'on Meta but paused', ACTIVE: 'running', COMPLETED: 'finished', FAILED: 'failed',
  REJECTED: 'rejected', CANCELLED: 'cancelled',
}

function mustBe(ad: StateAd, action: string, from: readonly AdStatus[]) {
  if (!(from as readonly string[]).includes(ad.status)) {
    throw conflict(`Cannot ${action} this ad: it is ${LABEL[ad.status] ?? ad.status.toLowerCase()}.`)
  }
}

function mustBeOwner(actor: Actor, what: string) {
  if (actor.role !== 'OWNER') throw conflict(`Only the owner can ${what}.`)
}

const NO_EXTERNAL = { externalCampaignId: null, externalAdSetId: null, externalCreativeId: null, externalAdId: null } as const

export function transitionAd(ad: StateAd, action: AdAction, actor: Actor, opts: AdTransitionOpts = {}): AdTransitionResult {
  const now = opts.now ?? new Date()
  switch (action) {
    case 'submit':
      mustBe(ad, 'submit', ['DRAFT'])
      return { status: 'PENDING_APPROVAL' }
    case 'approve':
      mustBeOwner(actor, 'approve an ad')
      if (ad.status === 'PAUSED_ON_PLATFORM' && !ad.approvedAt) {
        // A budget or end-date change on an ad that is already on Meta: approve the new numbers.
        return { status: 'PAUSED_ON_PLATFORM', approvedBy: actor.username, approvedAt: now }
      }
      mustBe(ad, 'approve', ['PENDING_APPROVAL'])
      return { status: 'APPROVED', approvedBy: actor.username, approvedAt: now }
    case 'reject':
      mustBeOwner(actor, 'reject an ad')
      mustBe(ad, 'reject', ['PENDING_APPROVAL'])
      return { status: 'REJECTED', approvedBy: null, approvedAt: null }
    case 'create_on_platform':
      mustBeOwner(actor, 'create an ad on Meta')
      mustBe(ad, 'create', ['APPROVED', 'FAILED'])
      if (!ad.approvedBy || !ad.approvedAt) throw conflict('The owner has not approved this ad yet.')
      return { status: 'CREATING', error: null }
    case 'created':
      mustBe(ad, 'mark as created', ['CREATING'])
      return { status: 'PAUSED_ON_PLATFORM', error: null }
    case 'create_failed':
      mustBe(ad, 'mark as failed', ['CREATING'])
      return { status: 'FAILED', error: (opts.error ?? 'Creating the ad failed.').slice(0, 500) }
    case 'start':
      mustBeOwner(actor, 'start an ad')
      mustBe(ad, 'start', ['PAUSED_ON_PLATFORM'])
      if (!ad.externalAdId) throw conflict('This ad is not on Meta yet.')
      if (!ad.approvedBy || !ad.approvedAt) throw conflict('The owner has not approved the latest budget and dates yet.')
      return { status: 'ACTIVE', activatedBy: actor.username, activatedAt: now, error: null }
    case 'pause':
      mustBe(ad, 'pause', ['ACTIVE'])
      return { status: 'PAUSED_ON_PLATFORM' }
    case 'complete':
      mustBe(ad, 'finish', ['ACTIVE', 'PAUSED_ON_PLATFORM'])
      return { status: 'COMPLETED' }
    case 'cancel':
      if (ad.status === 'ACTIVE') throw conflict('Pause the ad first, then cancel it.')
      mustBe(ad, 'cancel', ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'FAILED', 'PAUSED_ON_PLATFORM'])
      return { status: 'CANCELLED' }
    case 'edit': {
      // Approval is for the exact words, photos, audience and money: any edit goes back to a draft.
      mustBe(ad, 'edit', ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'FAILED'])
      const base: AdTransitionResult = { status: 'DRAFT', approvedBy: null, approvedAt: null }
      return ad.status === 'FAILED' ? { ...base, ...NO_EXTERNAL } : base
    }
    case 'edit_live':
      if (ad.status === 'ACTIVE') throw conflict('Pause the ad before changing its budget or end date.')
      mustBe(ad, 'change the budget or end date of', ['PAUSED_ON_PLATFORM'])
      return { status: 'PAUSED_ON_PLATFORM', approvedBy: null, approvedAt: null }
    default:
      throw conflict('Unknown action.')
  }
}

/** Fields that can still change once the ad exists on Meta. */
export const LIVE_EDITABLE_FIELDS = ['dailyBudgetCents', 'endsAt'] as const
export const onPlatform = (status: string) => status === 'PAUSED_ON_PLATFORM' || status === 'ACTIVE'
