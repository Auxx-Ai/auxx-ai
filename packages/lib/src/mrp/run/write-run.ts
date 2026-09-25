// packages/lib/src/mrp/run/write-run.ts

import { type Database, type MrpPlanRunItemInsert, schema } from '@auxx/database'
import { calendarDayToInstant, type DayKey } from '@auxx/utils/calendar-day'
import { and, desc, eq, inArray, lt, ne } from 'drizzle-orm'
import { err, ok, type Result } from 'neverthrow'
import { chunkArray } from '../../import/utils/chunk-array'
import type { PlanItem } from '../types'

const R = schema.MrpPlanRun
const I = schema.MrpPlanRunItem
const ITEM_CHUNK = 500

/** What started a run. */
export type MrpRunTrigger = 'nightly' | 'manual'

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error))

/**
 * Insert a `running` run and return its id.
 *
 * `asOf` is stored at noon UTC of the book day, so a UTC slice and a book-zone read both give the day back.
 */
export async function startRun(
  db: Database,
  organizationId: string,
  input: { asOf: DayKey; params: Record<string, unknown>; trigger: MrpRunTrigger }
): Promise<Result<string, Error>> {
  try {
    const [row] = await db
      .insert(R)
      .values({
        organizationId,
        status: 'running',
        asOf: new Date(calendarDayToInstant(input.asOf)),
        params: { ...input.params, trigger: input.trigger },
      })
      .returning({ id: R.id })
    if (!row) return err(new Error('MRP run insert returned no row'))
    return ok(row.id)
  } catch (error) {
    return err(toError(error))
  }
}

/** Write the items, move `isLatest` from the previous run's items to these, and mark the run completed, in one transaction. */
export async function completeRun(
  db: Database,
  runId: string,
  items: readonly PlanItem[]
): Promise<Result<{ itemCount: number }, Error>> {
  try {
    return await db.transaction(async (tx) => {
      const [run] = await tx
        .select({ organizationId: R.organizationId, asOf: R.asOf, status: R.status })
        .from(R)
        .where(eq(R.id, runId))
        .for('update')
      if (!run) return err(new Error(`MRP run ${runId} not found`))
      if (run.status !== 'running') {
        return err(new Error(`MRP run ${runId} is ${run.status}, not running`))
      }

      await tx
        .update(I)
        .set({ isLatest: false })
        .where(
          and(
            eq(I.organizationId, run.organizationId),
            eq(I.isLatest, true),
            ne(I.mrpPlanRunId, runId)
          )
        )

      const rows: MrpPlanRunItemInsert[] = items.map((item) => ({
        ...item,
        mrpPlanRunId: runId,
        organizationId: run.organizationId,
        runAsOf: run.asOf,
        isLatest: true,
      }))
      for (const chunk of chunkArray(rows, ITEM_CHUNK)) await tx.insert(I).values(chunk)

      await tx
        .update(R)
        .set({ status: 'completed', finishedAt: new Date(), error: null })
        .where(eq(R.id, runId))
      return ok({ itemCount: rows.length })
    })
  } catch (error) {
    return err(toError(error))
  }
}

/** Mark a run failed; called outside the rolled-back transaction so the Runs page can show why. */
export async function failRun(
  db: Database,
  runId: string,
  error: unknown
): Promise<Result<void, Error>> {
  try {
    await db
      .update(R)
      .set({ status: 'failed', finishedAt: new Date(), error: toError(error).message })
      .where(and(eq(R.id, runId), eq(R.status, 'running')))
    return ok(undefined)
  } catch (e) {
    return err(toError(e))
  }
}

/** Mark the org's runs still `running` after `maxAgeMs` as failed: a worker died mid-run and nothing else will. */
export async function failStaleRuns(
  db: Database,
  organizationId: string,
  maxAgeMs: number
): Promise<Result<{ failed: number }, Error>> {
  try {
    const rows = await db
      .update(R)
      .set({ status: 'failed', finishedAt: new Date(), error: 'orphaned: worker did not finish' })
      .where(
        and(
          eq(R.organizationId, organizationId),
          eq(R.status, 'running'),
          lt(R.startedAt, new Date(Date.now() - maxAgeMs))
        )
      )
      .returning({ id: R.id })
    return ok({ failed: rows.length })
  } catch (error) {
    return err(toError(error))
  }
}

/** Delete completed and failed runs started before the retention, never the latest completed one; items cascade. */
export async function pruneRuns(
  db: Database,
  organizationId: string,
  retentionDays: number
): Promise<Result<{ deleted: number }, Error>> {
  try {
    const cutoff = new Date(Date.now() - Math.max(1, retentionDays) * 86_400_000)
    const [latest] = await db
      .select({ id: R.id })
      .from(R)
      .where(and(eq(R.organizationId, organizationId), eq(R.status, 'completed')))
      .orderBy(desc(R.finishedAt), desc(R.startedAt))
      .limit(1)
    const deleted = await db
      .delete(R)
      .where(
        and(
          eq(R.organizationId, organizationId),
          inArray(R.status, ['completed', 'failed']),
          lt(R.startedAt, cutoff),
          latest ? ne(R.id, latest.id) : undefined
        )
      )
      .returning({ id: R.id })
    return ok({ deleted: deleted.length })
  } catch (error) {
    return err(toError(error))
  }
}
