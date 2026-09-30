// packages/lib/src/inventory/builds/undo-backflush-queries.ts

/** Reads of an undo run's `SyncJob` row, and which batch runs backflush wrote (plans/mrp/17 §8). */

import { type Database, schema } from '@auxx/database'
import { and, desc, eq, inArray, isNotNull, lt, notExists, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { BuildSource } from '../../resources/registry/enum-values'
import {
  ACTIVE_BACKFLUSH_STATUSES,
  BACKFLUSH_RUN_CATEGORY,
  BACKFLUSH_RUN_TYPE,
} from './backflush-run-queries'
import type { BackflushRunStatus } from './backflush-types'
import type { UndoBackflushRun, UndoBackflushRunMetadata } from './undo-backflush-types'

/** `SyncJob.type` of an undo run; same category as the backflush, so one index serves both. */
export const UNDO_BACKFLUSH_RUN_TYPE = 'backflush_undo'

/** The row as the job and the panel need it. */
export interface UndoBackflushRunRow {
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
  metadata: UndoBackflushRunMetadata
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

const isUndo = (organizationId: string) =>
  and(
    eq(schema.SyncJob.organizationId, organizationId),
    eq(schema.SyncJob.type, UNDO_BACKFLUSH_RUN_TYPE),
    eq(schema.SyncJob.integrationCategory, BACKFLUSH_RUN_CATEGORY)
  )

function toRow(
  row: Omit<UndoBackflushRunRow, 'status' | 'metadata'> & { status: string; metadata: unknown }
) {
  return row as UndoBackflushRunRow
}

/** One undo run by id, or the org's latest when `runId` is omitted; `null` when there is none. */
export async function readUndoBackflushRunRow(
  db: Database,
  organizationId: string,
  runId?: string
): Promise<UndoBackflushRunRow | null> {
  const [row] = await db
    .select(columns)
    .from(schema.SyncJob)
    .where(and(isUndo(organizationId), runId ? eq(schema.SyncJob.id, runId) : undefined))
    .orderBy(desc(schema.SyncJob.createdAt))
    .limit(1)
  return row ? toRow(row) : null
}

/**
 * The org's live backflush or undo run, if any. Both write builds from the same ledger, so only
 * one of either may run per org; every claim checks this under the same advisory lock.
 */
export async function findLiveBackflushOrUndoRun(
  db: Database,
  organizationId: string
): Promise<{ id: string; kind: 'backflush' | 'undo' } | null> {
  const [row] = await db
    .select({ id: schema.SyncJob.id, type: schema.SyncJob.type })
    .from(schema.SyncJob)
    .where(
      and(
        eq(schema.SyncJob.organizationId, organizationId),
        eq(schema.SyncJob.integrationCategory, BACKFLUSH_RUN_CATEGORY),
        inArray(schema.SyncJob.type, [BACKFLUSH_RUN_TYPE, UNDO_BACKFLUSH_RUN_TYPE]),
        inArray(schema.SyncJob.status, ACTIVE_BACKFLUSH_STATUSES)
      )
    )
    .limit(1)
  if (!row) return null
  return { id: row.id, kind: row.type === UNDO_BACKFLUSH_RUN_TYPE ? 'undo' : 'backflush' }
}

/** Active undo runs across orgs whose heartbeat is older than `before`: the stale sweep's input. */
export async function listStaleUndoBackflushRuns(
  db: Database,
  input: { before: Date; limit: number }
): Promise<UndoBackflushRunRow[]> {
  const rows = await db
    .select(columns)
    .from(schema.SyncJob)
    .where(
      and(
        eq(schema.SyncJob.type, UNDO_BACKFLUSH_RUN_TYPE),
        eq(schema.SyncJob.integrationCategory, BACKFLUSH_RUN_CATEGORY),
        inArray(schema.SyncJob.status, ACTIVE_BACKFLUSH_STATUSES),
        lt(schema.SyncJob.updatedAt, input.before)
      )
    )
    .limit(input.limit)
  return rows.map(toRow)
}

/** Every `batchRun` number carried by a `source: backflush` build, newest first. */
export async function listBackflushRunNumbers(
  db: Database,
  organizationId: string
): Promise<number[]> {
  const rows = await db
    .selectDistinct({ runNumber: schema.Build.batchRun })
    .from(schema.Build)
    .where(
      and(
        eq(schema.Build.organizationId, organizationId),
        eq(schema.Build.source, BuildSource.BACKFLUSH),
        isNotNull(schema.Build.batchRun)
      )
    )
  return rows
    .map((row) => row.runNumber)
    .filter((n): n is number => n != null)
    .sort((a, b) => b - a)
}

/** Whether any backflush build still stands: run-numbered and not reversed. */
export async function hasStandingBackflushBuilds(
  db: Database,
  organizationId: string
): Promise<boolean> {
  const reversal = alias(schema.Build, 'standing_reversal')
  const reversedBy = db
    .select({ one: sql`1` })
    .from(reversal)
    .where(
      and(
        eq(reversal.organizationId, organizationId),
        eq(reversal.reversalOfBuildId, schema.Build.id)
      )
    )

  const [row] = await db
    .select({ id: schema.Build.id })
    .from(schema.Build)
    .where(
      and(
        eq(schema.Build.organizationId, organizationId),
        eq(schema.Build.source, BuildSource.BACKFLUSH),
        isNotNull(schema.Build.batchRun),
        notExists(reversedBy)
      )
    )
    .limit(1)
  return !!row
}

/** The panel's view of an undo row. */
export function toUndoBackflushRun(row: UndoBackflushRunRow): UndoBackflushRun {
  const meta = row.metadata
  return {
    runId: row.id,
    status: row.status,
    scope: meta.scope,
    runNumbers: meta.runNumbers,
    total: row.totalRecords,
    processed: row.processedRecords,
    cancelled: meta.cancelled,
    reversed: meta.reversed,
    skipped: meta.skipped,
    failed: meta.failed,
    failures: meta.failures,
    error: row.error,
    startedAt: row.startTime,
    endedAt: row.endTime,
    finalizedAt: meta.finalizedAt,
  }
}
