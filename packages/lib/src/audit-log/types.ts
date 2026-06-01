// packages/lib/src/audit-log/types.ts
// Server-side audit types. Narrows the structural @auxx/database input with the
// client-safe unions from ./constants.

import type { AuditContext, AuditLogEntity } from '@auxx/database'
import type { AuditAction } from './audit-actions'
import type { AuditActorType, AuditCategory, AuditVisibility } from './constants'

export type { AuditContext, AuditLogEntity }

/** Narrowly-typed input to {@link recordAudit}. */
export interface AuditInput {
  /** NULL = platform-level event (super-admin only). */
  organizationId: string | null
  category: AuditCategory
  /** Known action (autocomplete) or any ad-hoc string — stays plain text in the DB. */
  action: AuditAction
  actorType: AuditActorType
  actorId?: string | null
  targetType?: string | null
  targetId?: string | null
  reason?: string | null
  previousState?: unknown
  newState?: unknown
  metadata?: Record<string, unknown> | null
  /** Defaults to 'admin' (customer-visible). */
  visibility?: AuditVisibility
  context?: AuditContext
}

/** Opaque pagination cursor for list queries. */
export interface AuditCursor {
  createdAt: string
  id: string
}

export interface ListAuditEventsInput {
  organizationId: string
  category?: AuditCategory
  actorId?: string
  action?: string
  /** Defaults to 'admin' (the customer-visible feed). Pass null to include all. */
  visibility?: AuditVisibility | null
  from?: Date
  to?: Date
  limit?: number
  cursor?: AuditCursor
}

export interface ListAllAuditEventsInput {
  /** Omit for cross-org; pass to scope to one org. */
  organizationId?: string | null
  category?: AuditCategory
  actorId?: string
  action?: string
  visibility?: AuditVisibility
  from?: Date
  to?: Date
  limit?: number
  cursor?: AuditCursor
}

export interface ListAuditEventsResult {
  items: AuditLogEntity[]
  nextCursor: AuditCursor | null
}
