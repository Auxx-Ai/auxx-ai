// packages/database/src/db/audit/to-audit-row.ts
// Single column-mapping builder for AuditLog rows, shared across every write path:
// @auxx/lib's recordAudit, @auxx/billing's audit-logger, and the app-versions admin
// inserts. Lives in @auxx/database (tier 1) so tier-2 callers that cannot import
// @auxx/lib still build identical rows. Typed structurally (category: string) — narrow
// union typing/validation happens at the lib/tRPC layer, not here.

/** Request context captured at the HTTP/auth layer (absent for bus-projected rows). */
export interface AuditContext {
  ipAddress?: string | null
  userAgent?: string | null
  sessionId?: string | null
}

/** Structural input to {@link toAuditRow}. */
export interface AuditRowInput {
  /** NULL = platform-level event (super-admin only). */
  organizationId: string | null
  category: string
  action: string
  actorType: string
  actorId?: string | null
  targetType?: string | null
  targetId?: string | null
  reason?: string | null
  previousState?: unknown
  newState?: unknown
  metadata?: Record<string, unknown> | null
  /** Defaults to 'admin' (customer-visible). */
  visibility?: string
  context?: AuditContext
}

/** Shape of an AuditLog insert row (matches the Drizzle table columns). */
export interface AuditRow {
  organizationId: string | null
  category: string
  action: string
  actorType: string
  actorId: string | null
  targetType: string | null
  targetId: string | null
  ipAddress: string | null
  userAgent: string | null
  sessionId: string | null
  reason: string | null
  previousState: unknown
  newState: unknown
  metadata: Record<string, unknown> | null
  visibility: string
}

/** Normalize an audit input into an AuditLog insert row (applies defaults, flattens context). */
export function toAuditRow(input: AuditRowInput): AuditRow {
  return {
    organizationId: input.organizationId,
    category: input.category,
    action: input.action,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    ipAddress: input.context?.ipAddress ?? null,
    userAgent: input.context?.userAgent ?? null,
    sessionId: input.context?.sessionId ?? null,
    reason: input.reason ?? null,
    previousState: input.previousState ?? null,
    newState: input.newState ?? null,
    metadata: input.metadata ?? null,
    visibility: input.visibility ?? 'admin',
  }
}
