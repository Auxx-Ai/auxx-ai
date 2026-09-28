// packages/lib/src/inventory/builds/undo-backflush-mutations.ts

/** Writes of an undo run's `SyncJob` row (plans/mrp/17 §8). `updatedAt` is the heartbeat. */

import { type Database, schema } from '@auxx/database'
import { SYNC_STATUS } from '@auxx/database/enums'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { ConflictError } from '../../errors'
import { ACTIVE_BACKFLUSH_STATUSES, BACKFLUSH_RUN_CATEGORY } from './backflush-run-queries'
import { findLiveBackflushOrUndoRun, UNDO_BACKFLUSH_RUN_TYPE } from './undo-backflush-queries'
import type { UndoBackflushRunMetadata, UndoBackflushScope } from './undo-backflush-types'

/**
 * Insert a PENDING undo run, refused with `ConflictError` while the org has a live backflush or
 * undo run. Takes the backflush claim's advisory lock, so the two claims serialize.
 */
export async function claimUndoBackflushRun(
  db: Database,
  organizationId: string,
  input: {
    scope: UndoBackflushScope
    actorUserId: string
    /** Resolved under the lock, so a backflush that just finished is included. */
    resolve: () => Promise<{ runNumbers: number[]; total: number }>
  }
): Promise<{ runId: string; runNumbers: number[] }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`backflush:${organizationId}`}))`)
    const live = await findLiveBackflushOrUndoRun(tx as unknown as Database, organizationId)
    if (live) {
      throw new ConflictError(
        live.kind === 'undo'
          ? 'Past builds are already being undone for this organization'
          : 'A backflush is running for this organization; wait for it to finish',
        { runId: live.id, kind: live.kind }
      )
    }
    const { runNumbers, total } = await input.resolve()
    const metadata: UndoBackflushRunMetadata = {
      scope: input.scope,
      runNumbers,
      actorUserId: input.actorUserId,
      cursor: null,
      cancelled: 0,
      reversed: 0,
      skipped: 0,
      failed: 0,
      failures: [],
      recoveries: 0,
      finalizedAt: null,
    }
    const now = new Date()
    const [row] = await tx
      .insert(schema.SyncJob)
      .values({
        type: UNDO_BACKFLUSH_RUN_TYPE,
        integrationCategory: BACKFLUSH_RUN_CATEGORY,
        integrationId: null,
        status: SYNC_STATUS.PENDING,
        organizationId,
        totalRecords: total,
        startTime: now,
        updatedAt: now,
        metadata: metadata as unknown as Record<string, unknown>,
      })
      .returning({ id: schema.SyncJob.id })
    if (!row) throw new Error('The undo run row was not inserted')
    return { runId: row.id, runNumbers }
  })
}

/** PENDING → IN_PROGRESS; a no-op on a run already started. */
export async function markUndoBackflushRunStarted(db: Database, runId: string): Promise<boolean> {
  const now = new Date()
  const rows = await db
    .update(schema.SyncJob)
    .set({ status: SYNC_STATUS.IN_PROGRESS, startTime: now, updatedAt: now })
    .where(and(eq(schema.SyncJob.id, runId), eq(schema.SyncJob.status, SYNC_STATUS.PENDING)))
    .returning({ id: schema.SyncJob.id })
  return rows.length > 0
}

/** Advance the checkpoint only if the cursor is still `expectedCursor`; `false` = lost the race. */
export async function checkpointUndoBackflushRun(
  db: Database,
  runId: string,
  input: {
    expectedCursor: string | null
    processedRecords: number
    failedRecords: number
    metadata: UndoBackflushRunMetadata
  }
): Promise<boolean> {
  const rows = await db
    .update(schema.SyncJob)
    .set({
      processedRecords: input.processedRecords,
      failedRecords: input.failedRecords,
      metadata: input.metadata as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.SyncJob.id, runId),
        inArray(schema.SyncJob.status, ACTIVE_BACKFLUSH_STATUSES),
        sql`${schema.SyncJob.metadata}->>'cursor' IS NOT DISTINCT FROM ${input.expectedCursor}`
      )
    )
    .returning({ id: schema.SyncJob.id })
  return rows.length > 0
}

/** Bump the heartbeat and the recovery count when the stale sweep re-enqueues a run. */
export async function recordUndoBackflushRecovery(
  db: Database,
  runId: string,
  recoveries: number
): Promise<void> {
  await db
    .update(schema.SyncJob)
    .set({
      metadata: sql`jsonb_set(${schema.SyncJob.metadata}, '{recoveries}', to_jsonb(${recoveries}::int))`,
      updatedAt: new Date(),
    })
    .where(eq(schema.SyncJob.id, runId))
}

/** Terminal success. */
export async function completeUndoBackflushRun(
  db: Database,
  runId: string,
  metadata: UndoBackflushRunMetadata
): Promise<void> {
  const now = new Date()
  await db
    .update(schema.SyncJob)
    .set({
      status: SYNC_STATUS.COMPLETED,
      metadata: metadata as unknown as Record<string, unknown>,
      endTime: now,
      updatedAt: now,
    })
    .where(
      and(eq(schema.SyncJob.id, runId), inArray(schema.SyncJob.status, ACTIVE_BACKFLUSH_STATUSES))
    )
}

/** Terminal failure; builds already undone stay undone. */
export async function failUndoBackflushRun(
  db: Database,
  runId: string,
  error: string
): Promise<void> {
  const now = new Date()
  await db
    .update(schema.SyncJob)
    .set({ status: SYNC_STATUS.FAILED, error, endTime: now, updatedAt: now })
    .where(
      and(eq(schema.SyncJob.id, runId), inArray(schema.SyncJob.status, ACTIVE_BACKFLUSH_STATUSES))
    )
}
