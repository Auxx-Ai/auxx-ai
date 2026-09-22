// packages/lib/src/accounting/work-items/write.ts

import { type Database, schema, type Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { isTransientCode, nextAttemptDelayMs, type WorkItemStage } from './codes'
import type { WorkItemRefusal } from './refusal'

const logger = createScopedLogger('accounting-work-items')

type Db = Database | Transaction

/** Which stuck thing a row is: one per `(sourceKind, sourceId, occurrence, stage)`. */
export interface WorkItemKey {
  sourceKind: string
  sourceId: string
  stage: WorkItemStage
  occurrence?: number
}

function keyWhere(organizationId: string, key: WorkItemKey) {
  return and(
    eq(schema.AccountingWorkItem.organizationId, organizationId),
    eq(schema.AccountingWorkItem.sourceKind, key.sourceKind),
    eq(schema.AccountingWorkItem.sourceId, key.sourceId),
    eq(schema.AccountingWorkItem.occurrence, key.occurrence ?? 0),
    eq(schema.AccountingWorkItem.stage, key.stage)
  )
}

async function guarded<T>(label: string, context: object, run: () => Promise<T>) {
  try {
    return ok(await run())
  } catch (error) {
    logger.error(label, {
      ...context,
      error: error instanceof Error ? error.message : String(error),
    })
    return err(error instanceof Error ? error : new Error(String(error)))
  }
}

/**
 * Record a refusal. A repeat bumps `attempts` and reschedules; a new code replaces
 * the old one. Call on `db`, never inside the transaction the refusal rolled back.
 */
export async function upsertWorkItem(
  db: Db,
  organizationId: string,
  input: WorkItemKey & WorkItemRefusal
): Promise<Result<void, Error>> {
  const t = schema.AccountingWorkItem
  const firstDelay = nextAttemptDelayMs(input.reasonCode, 1)
  const values = {
    organizationId,
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    occurrence: input.occurrence ?? 0,
    stage: input.stage,
    reasonCode: input.reasonCode,
    role: input.role ?? null,
    railId: input.railId ?? null,
    glAccountId: input.glAccountId ?? null,
    periodKey: input.periodKey ?? null,
    externalRef: input.externalRef ?? null,
    detail: input.detail ?? {},
    attempts: 1,
    nextAttemptAt: firstDelay === null ? null : new Date(Date.now() + firstDelay),
  }
  // A repeat of the same code counts on; a new code starts over.
  const attempts = sql`(CASE WHEN ${t.reasonCode} = ${input.reasonCode} THEN ${t.attempts} + 1 ELSE 1 END)`
  const nextAttempt =
    firstDelay === null
      ? sql`NULL`
      : isTransientCode(input.reasonCode)
        ? sql`now() + make_interval(secs => LEAST(60 * power(2, ${attempts} - 1), 21600))`
        : values.nextAttemptAt
  return guarded('Could not record a work item', values, async () => {
    await db
      .insert(t)
      .values(values)
      .onConflictDoUpdate({
        target: [t.organizationId, t.sourceKind, t.sourceId, t.occurrence, t.stage],
        set: {
          reasonCode: values.reasonCode,
          role: values.role,
          railId: values.railId,
          glAccountId: values.glAccountId,
          periodKey: values.periodKey,
          externalRef: values.externalRef,
          detail: values.detail,
          attempts,
          nextAttemptAt: nextAttempt,
          updatedAt: new Date(),
        },
      })
  })
}

/** Success deletes the row. */
export async function deleteWorkItem(
  db: Db,
  organizationId: string,
  key: WorkItemKey
): Promise<Result<void, Error>> {
  return guarded('Could not clear a work item', { organizationId, ...key }, async () => {
    await db.delete(schema.AccountingWorkItem).where(keyWhere(organizationId, key))
  })
}

/** Every stage's rows for these sources - a deleted record takes its work with it (91 §8.9). */
export async function deleteWorkItemsForSources(
  db: Db,
  organizationId: string,
  input: { sourceKind: string; sourceIds: readonly string[] }
): Promise<Result<number, Error>> {
  const ids = [...new Set(input.sourceIds)]
  if (ids.length === 0) return ok(0)
  return guarded('Could not sweep work items', { organizationId, ...input }, async () => {
    const rows = await db
      .delete(schema.AccountingWorkItem)
      .where(
        and(
          eq(schema.AccountingWorkItem.organizationId, organizationId),
          eq(schema.AccountingWorkItem.sourceKind, input.sourceKind),
          inArray(schema.AccountingWorkItem.sourceId, ids)
        )
      )
      .returning({ id: schema.AccountingWorkItem.id })
    return rows.length
  })
}
