// packages/lib/src/audit-log/list-all-audit-events.ts

import { AuditLog, database } from '@auxx/database'
import { and, desc, eq, gte, lt, lte, or, type SQL } from 'drizzle-orm'
import { ResultAsync } from 'neverthrow'
import type { AuditLogError } from './errors'
import type { AuditCursor, ListAllAuditEventsInput, ListAuditEventsResult } from './types'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

function cursorCondition(cursor: AuditCursor): SQL | undefined {
  const at = new Date(cursor.createdAt)
  return or(lt(AuditLog.createdAt, at), and(eq(AuditLog.createdAt, at), lt(AuditLog.id, cursor.id)))
}

/**
 * Cross-org audit view (super-admin lens). Sees every visibility, including
 * platform-level rows where `organizationId IS NULL`. Optionally scope to one org.
 */
export function listAllAuditEvents(
  input: ListAllAuditEventsInput = {}
): ResultAsync<ListAuditEventsResult, AuditLogError> {
  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT)

  const conditions: (SQL | undefined)[] = []
  if (input.organizationId) conditions.push(eq(AuditLog.organizationId, input.organizationId))
  if (input.category) conditions.push(eq(AuditLog.category, input.category))
  if (input.actorId) conditions.push(eq(AuditLog.actorId, input.actorId))
  if (input.action) conditions.push(eq(AuditLog.action, input.action))
  if (input.visibility) conditions.push(eq(AuditLog.visibility, input.visibility))
  if (input.from) conditions.push(gte(AuditLog.createdAt, input.from))
  if (input.to) conditions.push(lte(AuditLog.createdAt, input.to))
  if (input.cursor) conditions.push(cursorCondition(input.cursor))

  const where = conditions.length ? and(...conditions) : undefined

  return ResultAsync.fromPromise(
    database
      .select()
      .from(AuditLog)
      .where(where)
      .orderBy(desc(AuditLog.createdAt), desc(AuditLog.id))
      .limit(limit + 1),
    (cause): AuditLogError => ({
      code: 'AUDIT_READ_FAILED',
      message: 'Failed to list audit events',
      cause,
    })
  ).map((rows) => {
    const hasMore = rows.length > limit
    const items = hasMore ? rows.slice(0, limit) : rows
    const last = items.at(-1)
    const nextCursor: AuditCursor | null =
      hasMore && last ? { createdAt: last.createdAt.toISOString(), id: last.id } : null
    return { items, nextCursor }
  })
}
