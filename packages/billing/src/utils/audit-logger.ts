// packages/billing/src/utils/audit-logger.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'

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
 * Creates an audit log entry for admin actions
 * @param db Database instance
 * @param input Audit log parameters
 */
export async function auditLog(db: Database, input: AuditLogInput): Promise<void> {
  await db.insert(schema.AdminActionLog).values({
    adminUserId: input.adminUserId,
    actionType: input.actionType,
    targetType: input.targetType,
    targetId: input.targetId,
    organizationId: input.organizationId || null,
    details: input.details || null,
    reason: input.reason || null,
    previousState: input.previousState || null,
    newState: input.newState || null,
    ipAddress: input.ipAddress || null,
    userAgent: input.userAgent || null,
    createdAt: new Date(),
  })
}
