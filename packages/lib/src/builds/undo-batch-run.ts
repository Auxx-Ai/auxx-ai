// packages/lib/src/builds/undo-batch-run.ts

/**
 * Undo a whole batch run.
 *
 * `plans/money/tasks/45-batch-only-builds.md` section 4, and section 10.8 for
 * why `skipped` is its own bucket.
 *
 * Every build carrying `build_batch_run = N`, and one rule per status:
 *
 * | status | action |
 * | --- | --- |
 * | `planned` | {@link cancelBuild}, reason naming the run |
 * | `in_progress` | {@link cancelBuild}, same |
 * | `completed` | {@link reverseBuild} |
 * | `canceled` | skip, already undone |
 * | already reversed | skip |
 *
 * ## 🛑 Never a delete
 *
 * The movement subledger is append-only (`updatable: false` on every field), so
 * a mistake is corrected by REVERSING and never by editing or removing. That is
 * the same call the auto-build trigger settled: we took the trigger and refused
 * the verb. A build that produced movements is corrected by its negation, and
 * one that produced none is still a record somebody may have looked at.
 *
 * ## 🛑 Undoing a COMPLETED run does not restate the original month
 *
 * `reverseMovement` and `reverseBuild` date the negation to NOW, so the
 * reversing movements land in today's open period rather than the period the
 * run was dated to (45 section 4.2). That is the accounting-correct answer: a
 * closed month is not reopened and the correction appears where corrections
 * belong. It also means undo is not a time machine, and the confirmation dialog
 * has to say so in those words before anybody presses it.
 *
 * ## 🛑 `skipped` is NOT `failed`
 *
 * `reverseBuild` refuses an already-reversed build with a `ConflictError` and a
 * reversal-of-a-reversal with a `BadRequestError`. Both are exactly what the
 * rules above ask for, so both are classified DELIBERATELY, from
 * {@link BatchRunBuild.alreadyReversed} and {@link BatchRunBuild.isReversal},
 * before the call is made. The two refusals are caught as a backstop and land in
 * `skipped` as well, because the pre-check and the write are not one
 * transaction. An undo reporting "3 failed" for three builds that are correctly
 * already undone is a summary people learn to ignore.
 *
 * ## ⚠️ Never throws, and an unknown run is empty
 *
 * Per-build isolation, exactly like `executeBackfill`: every build inside its
 * own `try`, the whole body inside the module {@link guard}, and a caller that
 * ignores a `failed` entry is behaving correctly. A run number no build carries
 * comes back as an EMPTY summary rather than a `NotFoundError` (45 section
 * 10.8): a run whose buckets all failed allocated a number and wrote nothing.
 *
 * ## ⚠️ Undo and the netting read agree, by two different mechanisms
 *
 * 45 section 10.7, which is what makes undo-then-rerun safe and is written down
 * here because neither half is obvious:
 *
 * - cancelling a `planned` build drops it out of `COVERAGE_STATUSES`, so the
 *   next run rebuilds it;
 * - reversing a `completed` build changes the coverage read not at all, because
 *   `completed` is deliberately not a coverage status. What makes it visible is
 *   that the negating movements re-SUM `part_quantity_on_hand`, which the demand
 *   read subtracts.
 *
 * No permission checks. The router asserts (`docs/lib-module-guide.md`
 * section 6), and it must assert BOTH halves the way `executeBackfill`'s caller
 * does, because the reversal path writes stock movements.
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import { BadRequestError, ConflictError } from '../errors'
import { type BatchRunBuild, readBatchRunBuilds } from './batch-run-queries'
import { cancelBuild } from './build-mutations'
import { guard } from './guard'
import { reverseBuild } from './reverse-build'
import type { UndoBatchRunEntry, UndoBatchRunSummary } from './types'

const logger = createScopedLogger('builds:undo-batch-run')

/** One progress line per this many builds, so a long undo is observable. */
const PROGRESS_EVERY = 25

/**
 * Cancel or reverse every build one run raised.
 *
 * @param runNumber the `build_batch_run` to undo. A number no build carries is
 *   an empty summary, never an error.
 * @returns what happened per build, never a throw. `err` is reserved for the
 *   failures that touched NOTHING AT ALL, such as a read that could not run.
 */
export async function undoBatchRun(
  db: Database,
  organizationId: string,
  userId: string,
  runNumber: number
): Promise<Result<UndoBatchRunSummary, Error>> {
  return guard(
    async () => {
      const loaded = await readBatchRunBuilds(db, organizationId, runNumber)
      // A read that could not run is the one thing this function does refuse:
      // undoing "the builds we managed to see" would leave the rest of the run
      // standing while reporting a complete undo.
      if (loaded.isErr()) throw loaded.error
      const builds = loaded.value

      const summary: UndoBatchRunSummary = {
        runNumber,
        total: builds.length,
        cancelled: [],
        reversed: [],
        skipped: [],
        failed: [],
      }
      if (builds.length === 0) return summary

      let handled = 0
      for (const build of builds) {
        // 🛑 One refused build must not lose the rest of the run.
        try {
          await undoOneBuild(db, organizationId, userId, runNumber, build, summary)
        } catch (error) {
          summary.failed.push(entry(build, 'failed', message(error)))
          logger.error('Undoing one build failed; continuing with the run', {
            organizationId,
            runNumber,
            buildId: build.buildId,
            reason: message(error),
          })
        }
        handled += 1
        if (handled % PROGRESS_EVERY === 0) {
          logger.info('Undoing a batch run', {
            organizationId,
            runNumber,
            handled,
            of: builds.length,
          })
        }
      }

      logger.info('Undid a batch run', {
        organizationId,
        runNumber,
        total: summary.total,
        cancelled: summary.cancelled.length,
        reversed: summary.reversed.length,
        skipped: summary.skipped.length,
        failed: summary.failed.length,
      })

      return summary
    },
    'Undoing a batch run failed',
    { organizationId, runNumber }
  )
}

/** The rules table, for one build. */
async function undoOneBuild(
  db: Database,
  organizationId: string,
  userId: string,
  runNumber: number,
  build: BatchRunBuild,
  summary: UndoBatchRunSummary
): Promise<void> {
  if (build.status === 'canceled') {
    summary.skipped.push(entry(build, 'skipped', 'This build was already cancelled'))
    return
  }

  if (build.status === 'planned' || build.status === 'in_progress') {
    const cancelled = await cancelBuild(db, organizationId, userId, {
      buildId: build.buildId,
      reason: `Cancelled by the undo of batch run ${runNumber}`,
    })
    if (cancelled.isErr()) {
      summary.failed.push(entry(build, 'failed', cancelled.error.message))
      return
    }
    summary.cancelled.push(entry(build, 'cancelled', null))
    return
  }

  if (build.status === 'completed') {
    // 🛑 Classified, not caught (45 section 10.8). Both of these are what the
    // rules ask for and neither is a failure.
    if (build.alreadyReversed) {
      summary.skipped.push(entry(build, 'skipped', 'This build has already been reversed'))
      return
    }
    if (build.isReversal) {
      summary.skipped.push(entry(build, 'skipped', 'This build is itself a reversal'))
      return
    }

    const reversed = await reverseBuild(db, organizationId, userId, {
      buildId: build.buildId,
      reason: `Reversed by the undo of batch run ${runNumber}`,
    })
    if (reversed.isErr()) {
      // The backstop: the pre-check above and this call are not one
      // transaction, so a reversal written in between still reads as a skip.
      const error = reversed.error
      if (error instanceof ConflictError || error instanceof BadRequestError) {
        summary.skipped.push(entry(build, 'skipped', error.message))
        return
      }
      summary.failed.push(entry(build, 'failed', error.message))
      return
    }

    const result = entry(build, 'reversed', null)
    result.reversalBuildId = reversed.value.buildId
    summary.reversed.push(result)
    return
  }

  // A build whose status value is missing entirely. Never defaulted (see
  // `resolveBuildStatus`), because guessing here would either cancel a run that
  // is live or reverse one that wrote nothing.
  summary.failed.push(entry(build, 'failed', 'This build has no status, so it cannot be undone'))
}

function entry(
  build: BatchRunBuild,
  outcome: UndoBatchRunEntry['outcome'],
  reason: string | null
): UndoBatchRunEntry {
  return { buildId: build.buildId, partId: build.partId, outcome, reason }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
