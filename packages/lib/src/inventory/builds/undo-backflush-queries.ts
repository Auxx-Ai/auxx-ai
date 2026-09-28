// packages/lib/src/inventory/builds/undo-backflush-queries.ts

/** Reads of an undo run's `SyncJob` row, and which batch runs backflush wrote (plans/mrp/17 §8). */

import { type Database, schema } from '@auxx/database'
import { and, desc, eq, inArray, isNotNull, isNull, lt } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { BuildSource } from '../../resources/registry/enum-values'
import { systemValueJoin } from '../../resources/system-records'
import {
  ACTIVE_BACKFLUSH_STATUSES,
  BACKFLUSH_RUN_CATEGORY,
  BACKFLUSH_RUN_TYPE,
} from './backflush-run-queries'
import type { BackflushRunStatus } from './backflush-types'
import { loadBuildContext } from './build-queries'
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

/** Every `build_batch_run` number carried by a live `source: backflush` build, newest first. */
export async function listBackflushRunNumbers(
  db: Database,
  organizationId: string
): Promise<number[]> {
  const ctx = await loadBuildContext(organizationId)
  const runField = ctx?.fields.build_batch_run
  const sourceField = ctx?.fields.build_source
  if (!ctx || !runField || !sourceField) return []

  const runValue = alias(schema.FieldValue, 'undo_run_v')
  const sourceValue = alias(schema.FieldValue, 'undo_source_v')
  const rows = await db
    .selectDistinct({ runNumber: runValue.valueNumber })
    .from(schema.EntityInstance)
    .innerJoin(
      runValue,
      and(systemValueJoin(runValue, runField.id), isNotNull(runValue.valueNumber))
    )
    .innerJoin(
      sourceValue,
      and(
        systemValueJoin(sourceValue, sourceField.id),
        eq(sourceValue.optionId, BuildSource.BACKFLUSH)
      )
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, ctx.defId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )

  return rows
    .map((row) => Number(row.runNumber))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => b - a)
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
