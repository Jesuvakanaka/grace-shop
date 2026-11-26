// VYRA Marketing hub (ZP-1200): the broadcast status machine. Pure, no database.
//   DRAFT -> PENDING_APPROVAL (submit) | CANCELLED
//   PENDING_APPROVAL -> APPROVED (approve, owner only) | REJECTED (reject) | DRAFT (edit)
//   APPROVED -> SENDING (send) | CANCELLED | DRAFT (edit: approval is for the exact words)
//   SENDING -> SENT | FAILED (finish) | CANCELLED (stop)
//   FAILED -> SENDING (retry the failed ones only) | CANCELLED
//   REJECTED -> DRAFT (edit)
import { WebsiteError } from '@/lib/website/http'

export const BROADCAST_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED', 'REJECTED'] as const
export type BroadcastStatus = (typeof BROADCAST_STATUSES)[number]

export const BROADCAST_OWNER_ACTIONS = ['submit', 'approve', 'reject', 'send', 'retry', 'cancel'] as const
export type BroadcastAction = (typeof BROADCAST_OWNER_ACTIONS)[number] | 'edit' | 'finish'

export interface StateBroadcast { status: string; approvedBy: string | null; approvedAt: Date | null }
export interface BroadcastActor { username: string; role: 'OWNER' | 'STAFF' | 'SYSTEM' }

export interface BroadcastTransition {
  status: BroadcastStatus
  approvedBy?: string | null
  approvedAt?: Date | null
  error?: string | null
}

const LABEL: Record<string, string> = {
  DRAFT: 'a draft', PENDING_APPROVAL: 'waiting for approval', APPROVED: 'approved', SENDING: 'being sent', SENT: 'sent',
  FAILED: 'failed', CANCELLED: 'cancelled', REJECTED: 'rejected',
}
const conflict = (m: string) => new WebsiteError(409, m)

function from(b: StateBroadcast, action: string, allowed: readonly BroadcastStatus[]) {
  if (!(allowed as readonly string[]).includes(b.status)) throw conflict(`Cannot ${action} this message: it is ${LABEL[b.status] ?? b.status.toLowerCase()}.`)
}

/**
 * The next fields for an action, or a 409 WebsiteError. Only the owner can approve, send, retry or stop a send;
 * 'finish' is raised by the sender itself (SYSTEM). `opts.failed` says whether a finished send left failures.
 */
export function transitionBroadcast(b: StateBroadcast, action: BroadcastAction, actor: BroadcastActor, opts: { now?: Date; failed?: boolean; error?: string | null } = {}): BroadcastTransition {
  const owner = actor.role === 'OWNER'
  const needOwner = (what: string) => { if (!owner) throw conflict(`Only the owner can ${what}.`) }
  switch (action) {
    case 'submit':
      from(b, 'submit', ['DRAFT'])
      return { status: 'PENDING_APPROVAL' }
    case 'approve':
      needOwner('approve a message')
      from(b, 'approve', ['PENDING_APPROVAL'])
      return { status: 'APPROVED', approvedBy: actor.username, approvedAt: opts.now ?? new Date() }
    case 'reject':
      needOwner('reject a message')
      from(b, 'reject', ['PENDING_APPROVAL'])
      return { status: 'REJECTED', approvedBy: null, approvedAt: null }
    case 'edit':
      from(b, 'edit', ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'])
      return { status: 'DRAFT', approvedBy: null, approvedAt: null }
    case 'send':
      // The runner (SYSTEM) may start an APPROVED message whose time has come; it still needs the owner's approval below.
      if (!owner && actor.role !== 'SYSTEM') throw conflict('Only the owner can send a message.')
      from(b, 'send', ['APPROVED'])
      if (!b.approvedBy || !b.approvedAt) throw conflict('The owner has not approved this yet.')
      return { status: 'SENDING', error: null }
    case 'retry':
      needOwner('retry a send')
      from(b, 'retry', ['FAILED'])
      if (!b.approvedBy || !b.approvedAt) throw conflict('The owner has not approved this yet.')
      return { status: 'SENDING', error: null }
    case 'cancel':
      needOwner('cancel a message')
      from(b, 'cancel', ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENDING', 'FAILED'])
      return { status: 'CANCELLED' }
    case 'finish':
      from(b, 'finish', ['SENDING'])
      return opts.failed ? { status: 'FAILED', error: opts.error ?? null } : { status: 'SENT', error: null }
  }
}

export const isEditableBroadcast = (status: string) => ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'].includes(status)
