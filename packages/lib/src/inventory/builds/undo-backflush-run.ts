// packages/lib/src/inventory/builds/undo-backflush-run.ts

/**
 * Undo past builds as a sliced, resumable run on a `SyncJob` row (plans/mrp/17 §8, Q1): every
 * backflush batch run, or one run from the drawer card. Claim, then a slice of builds per job,
 * then finalize, mirroring `backflush-run.ts`. Each build is still reversed on its own
 * (`reverseBuild`); the job only moves the work off the request and checkpoints it.
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import { getCachedEntityDefId, onCacheEvent } from '../../cache'
import { UnprocessableEntityError } from '../../errors'
import { getRealtimeService, publishRecordsInvalidated } from '../../realtime'
import { type BatchRunBuild, listBatchRuns, readBatchRunBuilds } from './batch-run-queries'
import { guard } from './guard'
import type { UndoBatchRunSummary } from './types'
import {
  checkpointUndoBackflushRun,
  claimUndoBackflushRun,
  completeUndoBackflushRun,
  markUndoBackflushRunStarted,
} from './undo-backflush-mutations'
import {
  listBackflushRunNumbers,
  readUndoBackflushRunRow,
  type UndoBackflushRunRow,
} from './undo-backflush-queries'
import { publishUndoBackflushRun } from './undo-backflush-realtime'
import type { UndoBackflushFailure, UndoBackflushRunMetadata } from './undo-backflush-types'
import { undoBatchRunBuild } from './undo-batch-run'

const logger = createScopedLogger('builds:undo-backflush-run')

/** Builds cancelled or reversed per slice: ~100-200 ms each, so a slice stays well inside the stale window. */
export const UNDO_SLICE_BUILDS = 500
const MAX_FAILURES = 20
const PROGRESS_EVERY = 25

/** What the job enqueues next; `null` when the run is finished or another worker owns it. */
export type UndoBackflushStep = { kind: 'slice'; cursor: string | null } | { kind: 'finalize' }

/** Claim an undo over every backflush run, or over `runNumber` alone; the caller enqueues slice 1. */
export async function startUndoBackflushRun(
  db: Database,
  organizationId: string,
  input: { actorUserId: string; runNumber?: number }
): Promise<Result<{ runId: string; runNumbers: number[] }, Error>> {
  return guard(
    async () =>
      claimUndoBackflushRun(db, organizationId, {
        scope: input.runNumber == null ? 'backflush' : 'run',
        actorUserId: input.actorUserId,
        resolve: async () => {
          const runNumbers =
            input.runNumber == null
              ? await listBackflushRunNumbers(db, organizationId)
              : [input.runNumber]
          const runs = await listBatchRuns(db, organizationId)
          if (runs.isErr()) throw runs.error
          const wanted = new Set(runNumbers)
          const total = runs.value
            .filter((run) => wanted.has(run.runNumber))
            .reduce((sum, run) => sum + run.willCancel + run.willReverse, 0)
          if (total === 0) {
            throw new UnprocessableEntityError(
              input.runNumber == null
                ? 'There are no past builds from backflush left to undo'
                : `Every build in run ${input.runNumber} has already been cancelled or reversed`
            )
          }
          return { runNumbers, total }
        },
      }),
    'Starting the undo run failed',
    { organizationId, runNumber: input.runNumber }
  )
}

/** Undo the next `sliceBuilds` builds after the cursor, then checkpoint. Re-running is safe. */
export async function runUndoBackflushSlice(
  db: Database,
  organizationId: string,
  runId: string,
  options: { sliceBuilds?: number; expectedCursor?: string | null } = {}
): Promise<Result<UndoBackflushStep | null, Error>> {
  return guard(
    async () => {
      const row = await readUndoBackflushRunRow(db, organizationId, runId)
      if (!row || !isActive(row)) return null
      if (options.expectedCursor !== undefined && options.expectedCursor !== row.metadata.cursor) {
        return null
      }
      if (row.status === 'PENDING' && (await markUndoBackflushRunStarted(db, runId))) {
        await publish(organizationId, row, 'started', 'IN_PROGRESS')
      }

      const meta = row.metadata
      const cursor = parseUndoCursor(meta.cursor)
      const runNumber = meta.runNumbers[cursor.runIndex]
      if (runNumber == null) return { kind: 'finalize' }

      const loaded = await readBatchRunBuilds(db, organizationId, runNumber)
      if (loaded.isErr()) throw loaded.error
      const after = cursor.after
      const remaining = loaded.value
        .sort(compareBuilds)
        .filter((build) => !after || compareBuilds(build, after) > 0)

      const limit = options.sliceBuilds ?? UNDO_SLICE_BUILDS
      const tally: UndoBatchRunSummary = {
        runNumber,
        total: 0,
        cancelled: [],
        reversed: [],
        skipped: [],
        failed: [],
      }
      let handled = 0
      let last: BatchRunBuild | null = null
      for (const build of remaining) {
        if (handled >= limit) break
        const counted = isActionable(build)
        if (counted) handled += 1
        try {
          await undoBatchRunBuild(db, organizationId, meta.actorUserId, runNumber, build, tally)
        } catch (error) {
          tally.failed.push({
            buildId: build.buildId,
            partId: build.partId,
            outcome: 'failed',
            reason: error instanceof Error ? error.message : String(error),
          })
        }
        last = build
        if (counted && handled % PROGRESS_EVERY === 0) {
          await publishUndoBackflushRun(organizationId, {
            runId,
            kind: 'progress',
            status: 'IN_PROGRESS',
            processed: row.processedRecords + handled,
            total: row.totalRecords,
            reversed: meta.reversed + tally.reversed.length,
            cancelled: meta.cancelled + tally.cancelled.length,
            failed: meta.failed + tally.failed.length,
          })
        }
      }

      const runDone = !last || last === remaining.at(-1)
      const nextCursor = runDone
        ? `${cursor.runIndex + 1}|`
        : `${cursor.runIndex}|${last?.createdAt.getTime()}|${last?.buildId}`
      const failures: UndoBackflushFailure[] = tally.failed.map((entry) => ({
        runNumber,
        buildId: entry.buildId,
        reason: entry.reason ?? 'unknown error',
      }))
      const next: UndoBackflushRunMetadata = {
        ...meta,
        cursor: nextCursor,
        cancelled: meta.cancelled + tally.cancelled.length,
        reversed: meta.reversed + tally.reversed.length,
        skipped: meta.skipped + tally.skipped.length,
        failed: meta.failed + tally.failed.length,
        failures: [...meta.failures, ...failures].slice(0, MAX_FAILURES),
      }
      const processed = row.processedRecords + handled
      const failed = row.failedRecords + failures.length
      const advanced = await checkpointUndoBackflushRun(db, runId, {
        expectedCursor: meta.cursor,
        processedRecords: processed,
        failedRecords: failed,
        metadata: next,
      })
      if (!advanced) {
        logger.warn('Another worker advanced this undo run first', { organizationId, runId })
        return null
      }
      await publishUndoBackflushRun(organizationId, {
        runId,
        kind: 'progress',
        status: 'IN_PROGRESS',
        processed,
        total: row.totalRecords,
        reversed: next.reversed,
        cancelled: next.cancelled,
        failed: next.failed,
      })
      if (runDone && cursor.runIndex + 1 >= meta.runNumbers.length) return { kind: 'finalize' }
      return { kind: 'slice', cursor: nextCursor }
    },
    'An undo slice failed',
    { organizationId, runId }
  )
}

/** One coarse realtime pass over builds, parts and movements, then COMPLETED. Safe to repeat. */
export async function finalizeUndoBackflushRun(
  db: Database,
  organizationId: string,
  runId: string
): Promise<Result<boolean, Error>> {
  return guard(
    async () => {
      const row = await readUndoBackflushRunRow(db, organizationId, runId)
      if (!row || !isActive(row)) return false
      const meta = row.metadata

      await announce(organizationId)
      const finished: UndoBackflushRunMetadata = { ...meta, finalizedAt: new Date().toISOString() }
      await onCacheEvent('stock-setup.changed', { orgId: organizationId })
      await completeUndoBackflushRun(db, runId, finished)
      await publishUndoBackflushRun(organizationId, {
        runId,
        kind: 'finished',
        status: 'COMPLETED',
        processed: row.processedRecords,
        total: row.totalRecords,
        reversed: meta.reversed,
        cancelled: meta.cancelled,
        failed: meta.failed,
      })
      logger.info('Undo run finished', {
        organizationId,
        runId,
        runNumbers: meta.runNumbers,
        reversed: meta.reversed,
        cancelled: meta.cancelled,
        skipped: meta.skipped,
        failed: meta.failed,
      })
      return true
    },
    'Finalizing the undo run failed',
    { organizationId, runId }
  )
}

/** Publish the terminal FAILED frame for a run the job gave up on. */
export async function publishUndoBackflushRunFailed(
  db: Database,
  organizationId: string,
  runId: string
): Promise<void> {
  const row = await readUndoBackflushRunRow(db, organizationId, runId)
  await onCacheEvent('stock-setup.changed', { orgId: organizationId })
  if (row) await publish(organizationId, row, 'finished', 'FAILED')
}

/** Parse the metadata cursor; `null` is the start of the first run. */
export function parseUndoCursor(cursor: string | null): {
  runIndex: number
  after: { createdAt: Date; buildId: string } | null
} {
  if (!cursor) return { runIndex: 0, after: null }
  const [index, ms, buildId] = cursor.split('|')
  const runIndex = Number(index) || 0
  if (!ms || !buildId) return { runIndex, after: null }
  return { runIndex, after: { createdAt: new Date(Number(ms)), buildId } }
}

/** Builds written in one batch share a `createdAt`, so the id breaks the tie. */
function compareBuilds(
  left: { createdAt: Date; buildId: string },
  right: { createdAt: Date; buildId: string }
): number {
  const byTime = left.createdAt.getTime() - right.createdAt.getTime()
  if (byTime !== 0) return byTime
  return left.buildId < right.buildId ? -1 : left.buildId > right.buildId ? 1 : 0
}

/** Counted against `total` (`willCancel + willReverse` at claim). */
function isActionable(build: BatchRunBuild): boolean {
  if (build.status === 'planned' || build.status === 'in_progress') return true
  return build.status === 'completed' && !build.alreadyReversed && !build.isReversal
}

async function announce(organizationId: string) {
  const defIds = await Promise.all([
    getCachedEntityDefId(organizationId, 'build'),
    getCachedEntityDefId(organizationId, 'part'),
    getCachedEntityDefId(organizationId, 'stock_movement'),
  ])
  const entityDefinitionIds = defIds.filter((id): id is string => !!id)
  if (entityDefinitionIds.length === 0) return
  try {
    await publishRecordsInvalidated(getRealtimeService(), organizationId, { entityDefinitionIds })
  } catch {
    // Best effort; each reversal already published its own frames.
  }
}

function isActive(row: UndoBackflushRunRow): boolean {
  return row.status === 'PENDING' || row.status === 'IN_PROGRESS'
}

async function publish(
  organizationId: string,
  row: UndoBackflushRunRow,
  kind: 'started' | 'finished',
  status: UndoBackflushRunRow['status']
) {
  await publishUndoBackflushRun(organizationId, {
    runId: row.id,
    kind,
    status,
    processed: row.processedRecords,
    total: row.totalRecords,
    reversed: row.metadata.reversed,
    cancelled: row.metadata.cancelled,
    failed: row.metadata.failed,
  })
}
