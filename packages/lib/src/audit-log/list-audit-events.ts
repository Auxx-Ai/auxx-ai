// packages/lib/src/audit-log/list-audit-events.ts

import { AuditLog, database } from '@auxx/database'
import { and, desc, eq, gte, lt, lte, or, type SQL } from 'drizzle-orm'
import { ResultAsync } from 'neverthrow'
import type { AuditLogError } from './errors'
import type { AuditCursor, ListAuditEventsInput, ListAuditEventsResult } from './types'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

/** Keyset-pagination predicate: rows strictly older than the cursor (createdAt, id). */
function cursorCondition(cursor: AuditCursor): SQL | undefined {
  const at = new Date(cursor.createdAt)
  return or(lt(AuditLog.createdAt, at), and(eq(AuditLog.createdAt, at), lt(AuditLog.id, cursor.id)))
}

/**
 * Org-scoped audit feed (the customer-visible "Account Activity" lens). Defaults to
 * `visibility: 'admin'`; pass `visibility: null` to include internal rows too.
 */
export function listAuditEvents(
  input: ListAuditEventsInput
): ResultAsync<ListAuditEventsResult, AuditLogError> {
  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT)

  const conditions: (SQL | undefined)[] = [eq(AuditLog.organizationId, input.organizationId)]

  // visibility: explicit value filters; `null` means "all"; undefined defaults to 'admin'.
  if (input.visibility !== null) {
    conditions.push(eq(AuditLog.visibility, input.visibility ?? 'admin'))
  }
  if (input.category) conditions.push(eq(AuditLog.category, input.category))
  if (input.actorId) conditions.push(eq(AuditLog.actorId, input.actorId))
  if (input.action) conditions.push(eq(AuditLog.action, input.action))
  if (input.from) conditions.push(gte(AuditLog.createdAt, input.from))
  if (input.to) conditions.push(lte(AuditLog.createdAt, input.to))
  if (input.cursor) conditions.push(cursorCondition(input.cursor))

  return ResultAsync.fromPromise(
    database
      .select()
      .from(AuditLog)
      .where(and(...conditions))
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
