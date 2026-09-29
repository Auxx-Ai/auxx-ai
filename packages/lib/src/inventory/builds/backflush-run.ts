// packages/lib/src/inventory/builds/backflush-run.ts

/**
 * A backflush over a long range as a sliced, resumable run on a `SyncJob` row
 * (plans/mrp/11): claim, then one slice of days per job, then finalize once. The job
 * (`jobs/maintenance/backflush-job.ts`) enqueues whatever step these return.
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import { readBookTimeZoneOrUtc } from '../../accounting/ledger/setup/book-time-zone'
import { requestAccountingRecovery } from '../../accounting/work-items/recovery'
import { getCachedEntityDefId, onCacheEvent } from '../../cache'
import { UnprocessableEntityError } from '../../errors'
import { recordNumbering } from '../../records/record-numbering'
import { batchRecalculateQoH } from '../costing/qoh'
import { backflushBuilds } from './backflush'
import { BACKFLUSH_SLICE_DAYS, listBackflushDays, readBackflushGraph } from './backflush-planner'
import { resolveBackflushRange } from './backflush-range'
import {
  checkpointBackflushRun,
  claimBackflushRun,
  completeBackflushRun,
  markBackflushRunStarted,
} from './backflush-run-mutations'
import { type BackflushRunRow, readBackflushRunRow } from './backflush-run-queries'
import { publishBackflushRun } from './backflush-run-realtime'
import type { BackflushRunFailure, BackflushRunMetadata } from './backflush-types'
import { readBatchRunBuilds } from './batch-run-queries'
import { guard } from './guard'
import { readKindConflicts } from './kind-conflicts'
import { publishQuietBuildWrites } from './write-lane'

const logger = createScopedLogger('builds:backflush-run')

/** Failures kept on the row; the rest are only counted. */
const MAX_FAILURES = 20

/** What the job enqueues next; `null` when the run is finished or another worker owns it. */
export type BackflushStep = { kind: 'slice'; cursor: string | null } | { kind: 'finalize' }

/**
 * Claim a run and allocate its batch number; the caller enqueues the first slice. An absent end
 * is resolved by `resolveBackflushRange`. Refused while a kind conflict is left (plans/mrp/17 D3).
 */
export async function startBackflushRun(
  db: Database,
  organizationId: string,
  input: { from?: string; to?: string; actorUserId: string; now?: Date }
): Promise<Result<{ runId: string; batchRun: number }, Error>> {
  return guard(
    async () => {
      const conflicts = await readKindConflicts(db, organizationId)
      if (conflicts.isErr()) throw conflicts.error
      if (conflicts.value.length > 0) {
        throw new UnprocessableEntityError(kindConflictMessage(conflicts.value.length))
      }
      const now = input.now ?? new Date()
      const timeZone = await readBookTimeZoneOrUtc(organizationId)
      const graph = input.from === undefined ? await readBackflushGraph(db, organizationId) : null
      const range = await resolveBackflushRange(organizationId, input, {
        timeZone,
        now,
        madePartIds: graph?.order ?? [],
      })
      if (!range) throw new UnprocessableEntityError('No made part has any stock movement yet')
      const days = listBackflushDays(range, timeZone, now)
      if (days.length === 0) {
        throw new UnprocessableEntityError('No day in this range has ended yet')
      }
      return claimBackflushRun(db, organizationId, {
        from: range.from,
        to: range.to,
        actorUserId: input.actorUserId,
        totalDays: days.length,
        allocateBatchRun: async () =>
          (await recordNumbering.create(organizationId, 'build_batch')).sequenceNumber,
      })
    },
    'Starting the backflush run failed',
    { organizationId, from: input.from, to: input.to }
  )
}

/** Walk the next `sliceDays` days after the cursor, then checkpoint. Re-running a slice is safe. */
export async function runBackflushSlice(
  db: Database,
  organizationId: string,
  runId: string,
  options: {
    now?: Date
    sliceDays?: number
    batchBuilds?: number
    expectedCursor?: string | null
  } = {}
): Promise<Result<BackflushStep | null, Error>> {
  return guard(
    async () => {
      const row = await readBackflushRunRow(db, organizationId, runId)
      if (!row || !isActive(row)) return null
      // A duplicate job for a slice already walked must not walk the next one beside the chain.
      if (options.expectedCursor !== undefined && options.expectedCursor !== row.metadata.cursor) {
        return null
      }
      if (row.status === 'PENDING' && (await markBackflushRunStarted(db, runId))) {
        await publish(organizationId, row, 'started', 'IN_PROGRESS')
      }

      const meta = row.metadata
      if (meta.cursor && meta.cursor >= meta.to) return { kind: 'finalize' }
      const now = options.now ?? new Date()
      const timeZone = await readBookTimeZoneOrUtc(organizationId)
      const remaining = listBackflushDays(
        { from: meta.cursor ? nextDay(meta.cursor) : meta.from, to: meta.to },
        timeZone,
        now
      )
      const sliceDays = options.sliceDays ?? BACKFLUSH_SLICE_DAYS
      const slice = remaining.slice(0, sliceDays)
      const first = slice[0]
      const last = slice.at(-1)
      if (!first || !last) return { kind: 'finalize' }

      const result = await backflushBuilds(db, organizationId, {
        from: first.day,
        to: last.day,
        actorUserId: meta.actorUserId,
        now,
        run: { batchRun: meta.batchRun },
        sliceDays,
        batchBuilds: options.batchBuilds,
      })
      if (result.isErr()) throw result.error
      const summary = result.value

      const failures: BackflushRunFailure[] = [
        ...summary.failed.map((b) => ({ day: b.day, partName: b.partName, reason: b.reason })),
        ...summary.failedDays.map((d) => ({ day: d.day, partName: null, reason: d.reason })),
      ]
      const next: BackflushRunMetadata = {
        ...meta,
        cursor: last.day,
        written: meta.written + summary.written.length,
        failedBuilds: meta.failedBuilds + summary.failed.length,
        failedDays: meta.failedDays + summary.failedDays.length,
        failures: [...meta.failures, ...failures].slice(0, MAX_FAILURES),
      }
      const advanced = await checkpointBackflushRun(db, runId, {
        expectedCursor: meta.cursor,
        processedRecords: row.processedRecords + slice.length,
        failedRecords: row.failedRecords + failures.length,
        metadata: next,
      })
      if (!advanced) {
        logger.warn('Another worker advanced this backflush run first', { organizationId, runId })
        return null
      }
      await publishBackflushRun(organizationId, {
        runId,
        kind: 'progress',
        status: 'IN_PROGRESS',
        processed: row.processedRecords + slice.length,
        total: row.totalRecords,
        written: next.written,
        failed: row.failedRecords + failures.length,
      })
      return slice.length < remaining.length
        ? { kind: 'slice', cursor: last.day }
        : { kind: 'finalize' }
    },
    'A backflush slice failed',
    { organizationId, runId }
  )
}

/**
 * Once the cursor reaches the end: QoH over the run's parts, the posting/pricing sweep, one
 * realtime pass, then COMPLETED. Every step is safe to repeat, so a retried finalize re-runs it.
 */
export async function finalizeBackflushRun(
  db: Database,
  organizationId: string,
  runId: string
): Promise<Result<boolean, Error>> {
  return guard(
    async () => {
      const row = await readBackflushRunRow(db, organizationId, runId)
      if (!row || !isActive(row)) return false
      const meta = row.metadata

      // Each batch recalculates after its commit; a worker killed in between left QoH stale.
      const graph = await readBackflushGraph(db, organizationId)
      const parts = new Set(graph.order)
      for (const partId of graph.order) {
        for (const edge of graph.subparts.get(partId) ?? []) parts.add(edge.childId)
      }
      await batchRecalculateQoH(organizationId, [...parts])

      const builds = await readBatchRunBuilds(db, organizationId, meta.batchRun)
      if (builds.isErr()) throw builds.error
      await announce(
        organizationId,
        builds.value.map((b) => b.buildId),
        [...parts]
      )
      await requestAccountingRecovery(organizationId)

      const finished: BackflushRunMetadata = {
        ...meta,
        written: builds.value.filter((b) => b.status === 'completed').length,
        finalizedAt: new Date().toISOString(),
      }
      // Before COMPLETED is visible, so a client refetching on it reads the new status.
      await onCacheEvent('stock-setup.changed', { orgId: organizationId })
      await completeBackflushRun(db, runId, finished)
      await publishBackflushRun(organizationId, {
        runId,
        kind: 'finished',
        status: 'COMPLETED',
        processed: row.processedRecords,
        total: row.totalRecords,
        written: finished.written,
        failed: row.failedRecords,
      })
      logger.info('Backflush run finished', {
        organizationId,
        runId,
        batchRun: meta.batchRun,
        days: row.processedRecords,
        written: finished.written,
        failed: row.failedRecords,
      })
      return true
    },
    'Finalizing the backflush run failed',
    { organizationId, runId }
  )
}

/** Publish the terminal FAILED frame for a run the job gave up on. */
export async function publishBackflushRunFailed(
  db: Database,
  organizationId: string,
  runId: string
): Promise<void> {
  const row = await readBackflushRunRow(db, organizationId, runId)
  // A failed run may still have committed some days' builds.
  await onCacheEvent('stock-setup.changed', { orgId: organizationId })
  if (row) await publish(organizationId, row, 'finished', 'FAILED')
}

/** Coarse frames for clients that missed per-build ones (a worker killed after a commit). */
async function announce(organizationId: string, buildIds: string[], partIds: string[]) {
  const [buildDefId, partDefId] = await Promise.all([
    getCachedEntityDefId(organizationId, 'build'),
    getCachedEntityDefId(organizationId, 'part'),
  ])
  if (buildDefId) publishQuietBuildWrites(organizationId, buildDefId, buildIds)
  if (partDefId) publishQuietBuildWrites(organizationId, partDefId, partIds)
}

/** Why a backflush is refused while kinds conflict with parts lists. */
export function kindConflictMessage(count: number): string {
  const parts = count === 1 ? '1 part has a kind' : `${count} parts have a kind`
  return `${parts} that doesn't match its parts list. Fix ${count === 1 ? 'it' : 'them'} in Check parts first.`
}

function isActive(row: BackflushRunRow): boolean {
  return row.status === 'PENDING' || row.status === 'IN_PROGRESS'
}

async function publish(
  organizationId: string,
  row: BackflushRunRow,
  kind: 'started' | 'finished',
  status: BackflushRunRow['status']
) {
  await publishBackflushRun(organizationId, {
    runId: row.id,
    kind,
    status,
    processed: row.processedRecords,
    total: row.totalRecords,
    written: row.metadata.written,
    failed: row.failedRecords,
  })
}

function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}
