// packages/lib/src/inventory/builds/backflush-run-queries.ts

/** Reads of a backflush run's `SyncJob` row (plans/mrp/11 §2). */

import { type Database, schema } from '@auxx/database'
import { SYNC_STATUS } from '@auxx/database/enums'
import { and, desc, eq, inArray, lt } from 'drizzle-orm'
import type { BackflushRun, BackflushRunMetadata, BackflushRunStatus } from './backflush-types'

/** `SyncJob.type` of a backflush run. */
export const BACKFLUSH_RUN_TYPE = 'backflush'
/** `SyncJob.integrationCategory`; mail's guards filter on `'message'`, so the two never meet. */
export const BACKFLUSH_RUN_CATEGORY = 'inventory'

export const ACTIVE_BACKFLUSH_STATUSES = [SYNC_STATUS.PENDING, SYNC_STATUS.IN_PROGRESS]

/** The row as the job and the dialog need it. */
export interface BackflushRunRow {
  id: string
  organizationId: string
  status: BackflushRunStatus
  totalRecords: number
  processedRecords: number
  failedRecords: number
  error: string | null
  startTime: Date
  endTime: Date | null
  updatedAt: Date
  metadata: BackflushRunMetadata
}

const columns = {
  id: schema.SyncJob.id,
  organizationId: schema.SyncJob.organizationId,
  status: schema.SyncJob.status,
  totalRecords: schema.SyncJob.totalRecords,
  processedRecords: schema.SyncJob.processedRecords,
  failedRecords: schema.SyncJob.failedRecords,
  error: schema.SyncJob.error,
  startTime: schema.SyncJob.startTime,
  endTime: schema.SyncJob.endTime,
  updatedAt: schema.SyncJob.updatedAt,
  metadata: schema.SyncJob.metadata,
}

const isBackflush = (organizationId: string) =>
  and(
    eq(schema.SyncJob.organizationId, organizationId),
    eq(schema.SyncJob.type, BACKFLUSH_RUN_TYPE),
    eq(schema.SyncJob.integrationCategory, BACKFLUSH_RUN_CATEGORY)
  )

/** Every backflush row is written with its metadata, so the cast is the one place it is assumed. */
function toRow(
  row: Omit<BackflushRunRow, 'status' | 'metadata'> & { status: string; metadata: unknown }
) {
  return row as BackflushRunRow
}

/** One run by id, or the org's latest when `runId` is omitted; `null` when there is none. */
export async function readBackflushRunRow(
  db: Database,
  organizationId: string,
  runId?: string
): Promise<BackflushRunRow | null> {
  const [row] = await db
    .select(columns)
    .from(schema.SyncJob)
    .where(and(isBackflush(organizationId), runId ? eq(schema.SyncJob.id, runId) : undefined))
    .orderBy(desc(schema.SyncJob.createdAt))
    .limit(1)
  return row ? toRow(row) : null
}

/** The org's PENDING or IN_PROGRESS run, if any. */
export async function findActiveBackflushRun(
  db: Database,
  organizationId: string
): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: schema.SyncJob.id })
    .from(schema.SyncJob)
    .where(
      and(isBackflush(organizationId), inArray(schema.SyncJob.status, ACTIVE_BACKFLUSH_STATUSES))
    )
    .limit(1)
  return row ?? null
}

/** Active runs across orgs whose heartbeat is older than `before` — the stale sweep's input. */
export async function listStaleBackflushRuns(
  db: Database,
  input: { before: Date; limit: number }
): Promise<BackflushRunRow[]> {
  const rows = await db
    .select(columns)
    .from(schema.SyncJob)
    .where(
      and(
        eq(schema.SyncJob.type, BACKFLUSH_RUN_TYPE),
        eq(schema.SyncJob.integrationCategory, BACKFLUSH_RUN_CATEGORY),
        inArray(schema.SyncJob.status, ACTIVE_BACKFLUSH_STATUSES),
        lt(schema.SyncJob.updatedAt, input.before)
      )
    )
    .limit(input.limit)
  return rows.map(toRow)
}

/** The dialog's view of a run row. */
export function toBackflushRun(row: BackflushRunRow): BackflushRun {
  const meta = row.metadata
  return {
    runId: row.id,
    status: row.status,
    from: meta.from,
    to: meta.to,
    batchRun: meta.batchRun,
    totalDays: row.totalRecords,
    processedDays: row.processedRecords,
    written: meta.written,
    failed: row.failedRecords,
    failures: meta.failures,
    error: row.error,
    startedAt: row.startTime,
    endedAt: row.endTime,
    finalizedAt: meta.finalizedAt,
  }
}
