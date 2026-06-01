// packages/billing/src/utils/audit-logger.ts

import type { Database } from '@auxx/database'
import { AuditLog, toAuditRow } from '@auxx/database'

/** Input parameters for audit logging */
export interface AuditLogInput {
  adminUserId: string
  actionType: string
  targetType: string
  targetId: string
  organizationId?: string
  details?: any
  reason?: string
  previousState?: any
  newState?: any
  ipAddress?: string
  userAgent?: string
}

/**
 * Creates an audit log entry for admin (super-admin) billing actions.
 * Writes to the unified, immutable AuditLog under category 'billing' with
 * 'internal' visibility (super-admin only — these never surface in the
 * customer-facing activity feed).
 *
 * @param db Database instance
 * @param input Audit log parameters
 */
export async function auditLog(db: Database, input: AuditLogInput): Promise<void> {
  await db.insert(AuditLog).values(
    toAuditRow({
      organizationId: input.organizationId ?? null,
      category: 'billing',
      action: input.actionType,
      actorType: 'admin',
      actorId: input.adminUserId,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason,
      previousState: input.previousState,
      newState: input.newState,
      metadata: input.details ?? null,
      visibility: 'internal',
      context: { ipAddress: input.ipAddress, userAgent: input.userAgent },
    })
  )
}
