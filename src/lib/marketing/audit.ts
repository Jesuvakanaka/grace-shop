// VYRA Marketing hub (ZP-1200): every state change leaves an audit row. Server only.
import type { Prisma, PrismaClient } from '@prisma/client'

export type Db = PrismaClient | Prisma.TransactionClient

export interface AuditEntry {
  actor: string
  action: string
  entity: string
  entityId?: number | null
  detail?: Prisma.InputJsonValue
}

export async function writeAudit(db: Db, e: AuditEntry): Promise<void> {
  await db.marketingAuditLog.create({
    data: { actor: e.actor, action: e.action, entity: e.entity, entityId: e.entityId ?? null, detail: e.detail },
  })
}

export async function recentAudit(db: Db, limit = 50, entity?: string) {
  const take = Math.min(Math.max(Math.trunc(limit) || 50, 1), 200)
  return db.marketingAuditLog.findMany({ where: entity ? { entity } : {}, orderBy: { id: 'desc' }, take })
}
