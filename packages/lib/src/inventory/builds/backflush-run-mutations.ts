// packages/lib/src/inventory/builds/backflush-run-mutations.ts

/** Writes of a backflush run's `SyncJob` row (plans/mrp/11 §2). `updatedAt` is the heartbeat. */

import { type Database, schema } from '@auxx/database'
import { SYNC_STATUS } from '@auxx/database/enums'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { ConflictError } from '../../errors'
import {
  ACTIVE_BACKFLUSH_STATUSES,
  BACKFLUSH_RUN_CATEGORY,
  BACKFLUSH_RUN_TYPE,
  findActiveBackflushRun,
} from './backflush-run-queries'
import type { BackflushRunMetadata } from './backflush-types'

/**
 * Insert a PENDING run, refused with `ConflictError` while the org has an active one.
 * `allocateBatchRun` runs only once the claim holds, so a refused claim burns no number.
 */
export async function claimBackflushRun(
  db: Database,
  organizationId: string,
  input: {
    from: string
    to: string
    actorUserId: string
    totalDays: number
    allocateBatchRun: () => Promise<number>
  }
): Promise<{ runId: string; batchRun: number }> {
  return db.transaction(async (tx) => {
    // Serializes two concurrent claims for one org; released at commit.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`backflush:${organizationId}`}))`)
    const active = await findActiveBackflushRun(tx as unknown as Database, organizationId)
    if (active) {
      throw new ConflictError('A backflush is already running for this organization', {
        runId: active.id,
      })
    }
    const batchRun = await input.allocateBatchRun()
    const metadata: BackflushRunMetadata = {
      from: input.from,
      to: input.to,
      batchRun,
      actorUserId: input.actorUserId,
      cursor: null,
      written: 0,
      failedBuilds: 0,
      failedDays: 0,
      failures: [],
      recoveries: 0,
      finalizedAt: null,
    }
    const now = new Date()
    const [row] = await tx
      .insert(schema.SyncJob)
      .values({
        type: BACKFLUSH_RUN_TYPE,
        integrationCategory: BACKFLUSH_RUN_CATEGORY,
        integrationId: null,
        status: SYNC_STATUS.PENDING,
        organizationId,
        totalRecords: input.totalDays,
        startTime: now,
        updatedAt: now,
        metadata: metadata as unknown as Record<string, unknown>,
      })
      .returning({ id: schema.SyncJob.id })
    if (!row) throw new Error('The backflush run row was not inserted')
    return { runId: row.id, batchRun }
  })
}

/** PENDING → IN_PROGRESS; a no-op on a run already started. */
export async function markBackflushRunStarted(db: Database, runId: string): Promise<boolean> {
  const now = new Date()
  const rows = await db
    .update(schema.SyncJob)
    .set({ status: SYNC_STATUS.IN_PROGRESS, startTime: now, updatedAt: now })
    .where(and(eq(schema.SyncJob.id, runId), eq(schema.SyncJob.status, SYNC_STATUS.PENDING)))
    .returning({ id: schema.SyncJob.id })
  return rows.length > 0
}

/**
 * Advance the checkpoint, only if the cursor is still `expectedCursor`. `false` means another
 * worker advanced the run first, and the caller must not enqueue a successor.
 */
export async function checkpointBackflushRun(
  db: Database,
  runId: string,
  input: {
    expectedCursor: string | null
    processedRecords: number
    failedRecords: number
    metadata: BackflushRunMetadata
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
export async function recordBackflushRecovery(
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

/** Terminal success, after every finalize step. */
export async function completeBackflushRun(
  db: Database,
  runId: string,
  metadata: BackflushRunMetadata
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

/** Terminal failure; the builds already written stay, in the run's batch. */
export async function failBackflushRun(db: Database, runId: string, error: string): Promise<void> {
  const now = new Date()
  await db
    .update(schema.SyncJob)
    .set({ status: SYNC_STATUS.FAILED, error, endTime: now, updatedAt: now })
    .where(
      and(eq(schema.SyncJob.id, runId), inArray(schema.SyncJob.status, ACTIVE_BACKFLUSH_STATUSES))
    )
}
