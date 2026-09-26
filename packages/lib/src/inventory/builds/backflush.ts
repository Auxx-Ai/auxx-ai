// packages/lib/src/inventory/builds/backflush.ts

/**
 * Backflush (111 D23/D24): one completed build per made part per local day for whatever that
 * day's sales drove below zero, `source: 'backflush'`, dated the end of that day in the book
 * time zone. Parents first, so a lift built today consumes its motor assembly before the
 * assembly is checked. Idempotent: a re-run finds `qoh(day) >= 0` and writes nothing.
 *
 * Each slice is walked first and its builds written in batches (`recordCompletedBuilds`,
 * plans/mrp/12-slice-batched-backflush.md §2); a refused batch rolls back and the rest of the
 * slice is walked again build by build, so one refusal is one failed build.
 *
 * Never throws for one part or day — `executeBackfill`'s discipline. No permission checks;
 * the router asserts both halves (build and stock_movement), as for `completeBuild`.
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import { readBookTimeZoneOrUtc } from '../../accounting/ledger/setup/book-time-zone'
import { getOrgCache } from '../../cache'
import { recordNumbering } from '../../records/record-numbering'
import { systemFieldMap } from '../../resources/system-records'
import { raiseAndCompleteBuild } from './backfill-builds'
import {
  type BackflushDay,
  listBackflushDays,
  readBackflushGraph,
  walkBackflush,
} from './backflush-planner'
import type { BackflushBuild, BackflushRunSummary } from './backflush-types'
import { guard } from './guard'
import { recordCompletedBuilds } from './record-completed-builds'

const logger = createScopedLogger('builds:backflush')

export interface BackflushInput {
  /** Inclusive `YYYY-MM-DD` days in the book time zone. */
  from: string
  to: string
  /** Who the builds are attributed to; the org's system user when a job runs it. */
  actorUserId?: string
  /** Injected by tests; days whose end is after it are not walked. */
  now?: Date
  /** One slice of a sliced run (`backflush-run.ts`): its batch number. */
  run?: { batchRun: number }
  /** Days per ledger read; tests set 1 to compare against per-day reads. */
  sliceDays?: number
  /** Builds per write transaction, cut at a day; absent writes each slice as one batch. */
  batchBuilds?: number
}

export async function backflushBuilds(
  db: Database,
  organizationId: string,
  input: BackflushInput
): Promise<Result<BackflushRunSummary, Error>> {
  return guard(
    async () => {
      const now = input.now ?? new Date()
      const timeZone = await readBookTimeZoneOrUtc(organizationId)
      const days = listBackflushDays(input, timeZone, now)
      const summary: BackflushRunSummary = {
        batchRun: input.run?.batchRun ?? null,
        days: days.map((day) => day.day),
        written: [],
        failed: [],
        failedDays: [],
        skipped: 0,
      }
      if (days.length === 0) return summary

      const graph = await readBackflushGraph(db, organizationId)
      if (graph.order.length === 0) return summary
      const userId = input.actorUserId ?? (await getOrgCache().get(organizationId, 'systemUser'))

      const onDayError = (day: BackflushDay, error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error)
        summary.failedDays.push({ day: day.day, reason })
        logger.error('A backflush day failed; continuing with the range', {
          organizationId,
          day: day.day,
          reason,
        })
      }

      // The fallback: one transaction per build, as before batching.
      const completeOne = async (build: BackflushBuild): Promise<boolean> => {
        try {
          // Allocated on the first build, so an empty run burns no number (45 §3.2).
          summary.batchRun ??= await allocateRunNumber(organizationId)
          const { buildId } = await raiseAndCompleteBuild(db, organizationId, userId, {
            partId: build.partId,
            quantity: build.quantity,
            source: 'backflush',
            batchRun: summary.batchRun,
            completedAt: build.completedAt,
            notes: notesFor(build),
          })
          summary.written.push({ ...build, buildId })
          return true
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          summary.failed.push({ ...build, reason })
          logger.error('A backflush build failed; continuing with the run', {
            organizationId,
            partId: build.partId,
            day: build.day,
            reason,
          })
          return false
        }
      }

      // The walk plans a slice as if every build lands; the slice is then written in batches.
      const planned: BackflushBuild[] = []
      const writeSlice = async (
        slice: readonly BackflushDay[],
        skippedByDay: ReadonlyMap<string, number>
      ): Promise<number> => {
        const builds = planned.splice(0)
        let skipped = [...skippedByDay.values()].reduce((sum, n) => sum + n, 0)
        for (const batch of cutBatches(builds, input.batchBuilds)) {
          if (await writeBatch(db, organizationId, userId, summary, batch)) continue
          // Committed batches are in the ledger now, so walking the rest again redoes only this one.
          const rest = slice.slice(slice.findIndex((day) => day.day === batch[0]!.day))
          for (const day of rest) skipped -= skippedByDay.get(day.day) ?? 0
          const rewalk = await walkBackflush({
            organizationId,
            graph,
            days: rest,
            carry: false,
            sliceDays: rest.length,
            act: completeOne,
            onDayError,
          })
          skipped += rewalk.skipped
          break
        }
        return skipped
      }

      const { skipped } = await walkBackflush({
        organizationId,
        graph,
        days,
        carry: false,
        sliceDays: input.sliceDays,
        act: async (build) => {
          planned.push(build)
          return true
        },
        onDayError,
        onSlice: writeSlice,
      })
      summary.skipped = skipped

      logger.info('Backflushed builds', {
        organizationId,
        batchRun: summary.batchRun,
        days: days.length,
        written: summary.written.length,
        failed: summary.failed.length,
        failedDays: summary.failedDays.length,
      })
      return summary
    },
    'Backflushing builds failed',
    { organizationId, from: input.from, to: input.to }
  )
}

/** Write one batch; false when it was refused and rolled back, leaving the caller to re-walk. */
async function writeBatch(
  db: Database,
  organizationId: string,
  userId: string,
  summary: BackflushRunSummary,
  batch: BackflushBuild[]
): Promise<boolean> {
  try {
    summary.batchRun ??= await allocateRunNumber(organizationId)
  } catch (error) {
    logger.warn('Allocating the backflush run number failed; writing build by build', {
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
  const batchRun = summary.batchRun
  const written = await recordCompletedBuilds(
    db,
    organizationId,
    userId,
    batch.map((build) => ({
      partId: build.partId,
      quantity: build.quantity,
      source: 'backflush' as const,
      batchRun,
      completedAt: build.completedAt,
      notes: notesFor(build),
    }))
  )
  if (written.isErr()) {
    logger.warn('A backflush batch was refused; writing it build by build', {
      organizationId,
      builds: batch.length,
      from: batch[0]?.day,
      reason: written.error.message,
    })
    return false
  }
  written.value.forEach((result, index) => {
    summary.written.push({ ...batch[index]!, buildId: result.buildId })
  })
  return true
}

/** Consecutive days' builds up to `size` a batch, never splitting a day; one batch when unset. */
function cutBatches(builds: BackflushBuild[], size: number | undefined): BackflushBuild[][] {
  if (builds.length === 0) return []
  if (!size || size < 1) return [builds]
  const batches: BackflushBuild[][] = []
  let current: BackflushBuild[] = []
  for (const build of builds) {
    const last = current.at(-1)
    if (last && last.day !== build.day && current.length >= size) {
      batches.push(current)
      current = []
    }
    current.push(build)
  }
  batches.push(current)
  return batches
}

function notesFor(build: BackflushBuild): string {
  return `Backflush for ${build.day}`
}

/** One `build_batch` number per run; an org short of the field gets un-numbered builds and no undo. */
async function allocateRunNumber(organizationId: string): Promise<number> {
  const fields = await systemFieldMap(undefined, organizationId, ['build_batch_run'] as const)
  if (!fields.build_batch_run) {
    logger.warn('This organization has no build_batch_run field, so the run will be un-numbered', {
      organizationId,
    })
  }
  const { sequenceNumber } = await recordNumbering.create(organizationId, 'build_batch')
  return sequenceNumber
}
