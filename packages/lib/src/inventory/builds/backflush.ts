// packages/lib/src/inventory/builds/backflush.ts

/**
 * Backflush (111 D23/D24): one completed build per made part per local day for whatever that
 * day's sales drove below zero, `source: 'backflush'`, dated the end of that day in the book
 * time zone. Parents first, so a lift built today consumes its motor assembly before the
 * assembly is checked. Idempotent: a re-run finds `qoh(day) >= 0` and writes nothing.
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
import { rollStandardCost } from '../costing/standard-cost'
import { raiseAndCompleteBuild } from './backfill-builds'
import {
  type BackflushGraph,
  listBackflushDays,
  readBackflushGraph,
  walkBackflush,
} from './backflush-planner'
import type { BackflushBuild, BackflushRunSummary } from './backflush-types'
import { guard } from './guard'

const logger = createScopedLogger('builds:backflush')

export interface BackflushInput {
  /** Inclusive, as local days in the book time zone. */
  from: Date
  to: Date
  /** Who the builds and the roll are attributed to; the org's system user when a job runs it. */
  actorUserId?: string
  /** Injected by tests; days whose end is after it are not walked. */
  now?: Date
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
        batchRun: null,
        days: days.map((day) => day.day),
        written: [],
        leftInProgress: [],
        failed: [],
        failedDays: [],
        skipped: 0,
        rolled: [],
      }
      if (days.length === 0) return summary

      const graph = await readBackflushGraph(db, organizationId)
      if (graph.order.length === 0) return summary
      const userId = input.actorUserId ?? (await getOrgCache().get(organizationId, 'systemUser'))
      const rolled = new Set<string>()

      const act = async (build: BackflushBuild): Promise<boolean> => {
        try {
          await rollFirst(db, organizationId, userId, graph, build.partId, rolled, summary, now)
          // Allocated on the first build, so an empty run burns no number (45 §3.2).
          summary.batchRun ??= await allocateRunNumber(organizationId)
          const { buildId, leftInProgress } = await raiseAndCompleteBuild(
            db,
            organizationId,
            userId,
            {
              partId: build.partId,
              quantity: build.quantity,
              source: 'backflush',
              batchRun: summary.batchRun,
              completedAt: build.completedAt,
              notes: `Backflush for ${build.day}`,
            }
          )
          if (leftInProgress) {
            summary.leftInProgress.push({ ...build, buildId, reason: leftInProgress })
            logger.warn('A backflushed build was raised but not completed', {
              organizationId,
              partId: build.partId,
              day: build.day,
              buildId,
              reason: leftInProgress,
            })
            return false
          }
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

      const { skipped } = await walkBackflush({
        organizationId,
        graph,
        days,
        carry: false,
        act,
        onDayError: (day, error) => {
          const reason = error instanceof Error ? error.message : String(error)
          summary.failedDays.push({ day: day.day, reason })
          logger.error('A backflush day failed; continuing with the range', {
            organizationId,
            day: day.day,
            reason,
          })
        },
      })
      summary.skipped = skipped

      logger.info('Backflushed builds', {
        organizationId,
        batchRun: summary.batchRun,
        days: days.length,
        written: summary.written.length,
        leftInProgress: summary.leftInProgress.length,
        failed: summary.failed.length,
        failedDays: summary.failedDays.length,
        rolled: summary.rolled.length,
      })
      return summary
    },
    'Backflushing builds failed',
    { organizationId, from: input.from, to: input.to }
  )
}

/**
 * 111 Q20: before a part's first backflushed build this run, roll its standard so a provisional
 * (channel) standard becomes a rolled one and on hand is revalued once. A confirmed standard is
 * left alone. A failed roll is logged and the build still goes through — its legs come out
 * pending until a standard exists.
 */
async function rollFirst(
  db: Database,
  organizationId: string,
  userId: string,
  graph: BackflushGraph,
  partId: string,
  rolled: Set<string>,
  summary: BackflushRunSummary,
  now: Date
): Promise<void> {
  if (rolled.has(partId)) return
  rolled.add(partId)
  const confirmed =
    graph.standardCosts.get(partId) != null && graph.standardCostSources.get(partId) === 'confirmed'
  if (confirmed) return
  const result = await rollStandardCost(db, organizationId, userId, {
    partIds: [partId],
    effectiveAt: now,
  })
  if (result.isErr()) {
    logger.warn('The roll before a backflushed build was refused; the build still goes through', {
      organizationId,
      partId,
      reason: result.error.message,
    })
    return
  }
  summary.rolled.push(partId)
  for (const written of result.value.writtenPartIds) rolled.add(written)
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
