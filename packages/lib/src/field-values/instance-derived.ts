// packages/lib/src/field-values/instance-derived.ts
//
// The ONE statement that carries every derived `EntityInstance` column a
// field write leaves behind: the D-7 `updatedAt` content stamp, the
// `lastActivityAt` activity touch, and the `searchText` corpus recompute.
// Before this module each was its own UPDATE on the same row, added by a
// different plan in a different month (plans/field-values/update-path-and-events.md
// section 1d), and the callers then re-read the row to build their realtime
// frame. Folding them means one round trip, and `RETURNING` hands the fresh
// row back so nobody has to re-read it.

import { type Database, schema, type Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, type SQL, sql } from 'drizzle-orm'
import { searchTextExpressionSql } from './search-text'

const logger = createScopedLogger('field-values:instance-derived')

export type EntityInstanceRow = typeof schema.EntityInstance.$inferSelect

/** Which derived columns one flush should write. All default to `false`. */
export interface InstanceDerivedFlush {
  /** D-7 content stamp: the record's values performed a real change. */
  stampUpdatedAt?: boolean
  /** Advance `lastActivityAt` monotonically (never rewinds). */
  touchActivity?: boolean
  /** Recompute the `searchText` corpus from the record's current values. */
  refreshSearchText?: boolean
}

/** True when the flush would write at least one column. */
export function hasDerivedWork(flush: InstanceDerivedFlush): boolean {
  return (
    flush.stampUpdatedAt === true ||
    flush.touchActivity === true ||
    flush.refreshSearchText === true
  )
}

function setClauses(flush: InstanceDerivedFlush, at: Date): Partial<Record<string, Date | SQL>> {
  const set: Partial<Record<'updatedAt' | 'lastActivityAt' | 'searchText', Date | SQL>> = {}
  if (flush.stampUpdatedAt) set.updatedAt = at
  if (flush.touchActivity) {
    // Activity is bookkeeping, not content: it never rewinds, and on its own
    // it does not stamp `updatedAt` (the old `$onUpdate` bump re-dirtied
    // records into dedup rescans).
    const col = schema.EntityInstance.lastActivityAt
    set.lastActivityAt = sql`CASE WHEN ${col} IS NULL OR ${col} < ${at} THEN ${at} ELSE ${col} END`
  }
  if (flush.refreshSearchText) {
    set.searchText = sql.raw(searchTextExpressionSql('"EntityInstance"'))
  }
  return set
}

/**
 * Write the requested derived columns for ONE record in a single UPDATE and
 * return the fresh row. Returns `null` when nothing was requested, when the
 * row is gone, or when the statement failed: every column here is a
 * best-effort denormalization and a failure must never fail the write that
 * produced it (the dedup watermark still catches up via `FieldValue.updatedAt`).
 */
export async function flushInstanceDerived(
  db: Database | Transaction,
  organizationId: string,
  entityInstanceId: string,
  flush: InstanceDerivedFlush,
  at: Date = new Date()
): Promise<EntityInstanceRow | null> {
  if (!hasDerivedWork(flush)) return null
  try {
    const [row] = await db
      .update(schema.EntityInstance)
      .set(setClauses(flush, at))
      .where(
        and(
          eq(schema.EntityInstance.id, entityInstanceId),
          eq(schema.EntityInstance.organizationId, organizationId)
        )
      )
      .returning()
    return row ?? null
  } catch (error) {
    logger.error('Instance derived-column flush failed', {
      organizationId,
      entityInstanceId,
      flush,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * Batched form of {@link flushInstanceDerived} for the bulk writers: one
 * UPDATE across every record of the op, no RETURNING. Same best-effort
 * contract.
 */
export async function flushInstancesDerived(
  db: Database | Transaction,
  organizationId: string,
  entityInstanceIds: readonly string[],
  flush: InstanceDerivedFlush,
  at: Date = new Date()
): Promise<void> {
  if (entityInstanceIds.length === 0 || !hasDerivedWork(flush)) return
  try {
    await db
      .update(schema.EntityInstance)
      .set(setClauses(flush, at))
      .where(
        and(
          inArray(schema.EntityInstance.id, entityInstanceIds as string[]),
          eq(schema.EntityInstance.organizationId, organizationId)
        )
      )
  } catch (error) {
    logger.error('Batched instance derived-column flush failed', {
      organizationId,
      records: entityInstanceIds.length,
      flush,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
