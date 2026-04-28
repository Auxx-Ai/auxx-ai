// packages/lib/src/entity-instances/activity.ts

import { type Database, database, schema, type Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, or, sql } from 'drizzle-orm'

type DbOrTx = Database | Transaction

const logger = createScopedLogger('entity-activity')

/**
 * Advance `EntityInstance.lastActivityAt` for one or more entities, monotonically.
 *
 * "Monotonically" means: only writes when the new timestamp is strictly newer
 * than what's already stored. Out-of-order events (e.g. a delayed worker job
 * for an old message) cannot rewind activity.
 *
 * Caller responsibilities:
 * - Never call inside a tight loop without batching — the staleness scanner
 *   uses this column for filtering, so an unnecessary write triggers index churn.
 * - For thread-derived events (inbound message, comment), look up linked
 *   entities via Thread.primaryEntityInstanceId + ThreadEntityLink (active rows)
 *   and pass the full set in one call.
 */
export async function touchEntityActivity(
  entityInstanceIds: string[],
  organizationId: string,
  at: Date = new Date(),
  tx?: DbOrTx
): Promise<void> {
  if (entityInstanceIds.length === 0) return
  const db = tx ?? database

  try {
    await db
      .update(schema.EntityInstance)
      .set({ lastActivityAt: at })
      .where(
        and(
          inArray(schema.EntityInstance.id, entityInstanceIds),
          eq(schema.EntityInstance.organizationId, organizationId),
          // Monotonic guard — never rewind.
          or(
            sql`${schema.EntityInstance.lastActivityAt} IS NULL`,
            sql`${schema.EntityInstance.lastActivityAt} < ${at}`
          )
        )
      )
  } catch (error) {
    // Activity touch is a best-effort denormalized write. Don't break the
    // calling write path on failure.
    logger.warn('Failed to touch entity activity', {
      organizationId,
      entityInstanceIds,
      error: error instanceof Error ? error.message : error,
    })
  }
}

/**
 * Resolve every active linked entity for a thread (primary + secondaries) and
 * advance their `lastActivityAt`. Used by message / comment / thread hooks.
 */
export async function touchActivityForThreadLinks(
  threadId: string,
  organizationId: string,
  at: Date = new Date(),
  tx?: DbOrTx
): Promise<void> {
  const db = tx ?? database

  const [primary, secondaries] = await Promise.all([
    db
      .select({ id: schema.Thread.primaryEntityInstanceId })
      .from(schema.Thread)
      .where(and(eq(schema.Thread.id, threadId), eq(schema.Thread.organizationId, organizationId)))
      .limit(1),
    db
      .select({ id: schema.ThreadEntityLink.entityInstanceId })
      .from(schema.ThreadEntityLink)
      .where(
        and(
          eq(schema.ThreadEntityLink.threadId, threadId),
          eq(schema.ThreadEntityLink.organizationId, organizationId),
          sql`${schema.ThreadEntityLink.unlinkedAt} IS NULL`
        )
      ),
  ])

  const ids = new Set<string>()
  if (primary[0]?.id) ids.add(primary[0].id)
  for (const s of secondaries) {
    if (s.id) ids.add(s.id)
  }

  if (ids.size === 0) return
  await touchEntityActivity(Array.from(ids), organizationId, at, tx)
}
