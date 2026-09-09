// packages/lib/src/builds/backfill-builds.ts

/**
 * Phases 3 and 4 of the bulk builder — EXECUTE a {@link BackfillPlan}.
 *
 * `plans/money/tasks/44-auto-build-cutoff-and-backfill.md` sections 6 and 7.4.
 *
 * `backfill-policy.ts` decides what to build with no database, no clock and no
 * settings; this file writes it. The split is `reconcile-policy.ts` /
 * `reconcile-order-builds.ts` again, for the reason 44 section 11.1 gives: the
 * painful cases — on-hand spread across eight buckets, a completed build that
 * must not be counted twice — are unit tests rather than browser clicks.
 *
 * ## 🛑 It is NOT atomic, and the summary is what says so
 *
 * `createBuild -> startBuild -> completeBuild` is three separate writes, so a
 * refused completion leaves a raised run sitting at `in_progress` with no
 * movements. Section 7.4: that comes back as the `leftInProgress` RESULT rather
 * than an error, carrying the build id, and the run CONTINUES. An error channel
 * cannot name a build, so the person would be told "failed" about builds that
 * exist and would press the button again — the exact failure `build-now.ts`'s
 * header refuses, multiplied by four hundred.
 *
 * ## 🛑 `completedAt` is derived from the PERIOD, never from now
 *
 * It is THE accounting date, stamped on the build and on every stock movement
 * it writes, and it decides which month-end entry reflects the build. Dating
 * eight months of production to today puts all of it in one entry and leaves
 * the other seven showing no production at all. See
 * {@link resolveBackfillCompletedAt}, which derives it in the organization's
 * `accounting.bookTimeZone` for the same reason `postings/periods.ts` does.
 *
 * ## 🛑 The run number is allocated ONCE, in {@link prepareRun}
 *
 * `plans/money/tasks/45-batch-only-builds.md` section 3. Every build a run
 * raises carries the same `build_batch_run`, which is the only handle
 * `undoBatchRun` has, so the allocation belongs where everything else for the
 * run is resolved and nowhere near the bucket loop. Allocating per build would
 * burn the sequence and turn one four-hundred-build run into four hundred runs.
 * An empty plan returns before `prepareRun` and therefore burns no number.
 *
 * ## 🛑 Never throws
 *
 * Three layers, matching `reconcile-order-builds.ts`: every BUCKET inside its
 * own `try` so one refused completion does not lose the rest of the part; every
 * PART inside its own `try` so one bad part does not lose the run; and the whole
 * body inside the module {@link guard}. A caller that ignores the returned
 * `Result` is behaving correctly.
 *
 * ## Chunking and resumability
 *
 * No transaction spans the run. Each bucket is an independent set of writes, so
 * an interrupted run leaves the builds it already wrote and nothing half-written, and
 * re-running converges rather than duplicating: section 6.2's netting reads
 * ordered quantity minus built quantity per `(part, period)`, so a second pass
 * over a partly-backfilled range raises exactly the delta.
 *
 * ⚠️ **The quantity-on-hand recalculation is per build, not per run.**
 * `completeBuild` runs ONE `batchRecalculateQoH` over the produced part and
 * every consumed part, after its own commit (`complete-build.ts` traps 1 and 3),
 * and there is no way to defer it from out here. Batching across builds would
 * need `completeBuild` to take a deferral flag; the recalc is a full re-SUM and
 * therefore idempotent, so the cost of not batching is duplicated work, never a
 * wrong number.
 *
 * No permission checks. The router asserts (`docs/lib-module-guide.md`
 * section 6) — and it must assert BOTH halves, because the `completed` path
 * writes stock movements.
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { fromZonedTime } from 'date-fns-tz'
import type { Result } from 'neverthrow'
import { getOrgCache } from '../cache'
import { UnprocessableEntityError } from '../errors'
import { periodKeyForDate } from '../postings/periods'
import { OPENING_BASELINE_SETTING_KEYS } from '../postings/setup-readiness'
import { recordNumbering } from '../records/record-numbering'
import { getOrganizationSetting } from '../settings/settings-service'
import type {
  BackfillBucket,
  BackfillPlan,
  BackfillRequest,
  BackfillRunSummary,
} from './backfill-types'
import { createBuild, startBuild } from './build-mutations'
import { completeBuild } from './complete-build'
import { guard } from './guard'

const logger = createScopedLogger('builds:backfill')

/** One progress line per this many buckets, so a long run is observable. */
const PROGRESS_EVERY = 25

/**
 * {@link BackfillRunSummary} while it is still being assembled.
 *
 * The contract's arrays are `readonly` because nothing downstream may edit a
 * finished run; this is the same shape with them writable, and it is the only
 * thing the helpers below are handed.
 */
interface MutableRunSummary {
  batchRun: number | null
  created: { partId: string; buildId: string; quantity: number; periodKey: string }[]
  leftInProgress: { partId: string; buildId: string; reason: string }[]
  failed: { partId: string; bucketId: string; periodKey: string; reason: string }[]
}

/** Everything resolved once for the whole run, before any build is written. */
interface RunContext {
  /** `accounting.bookTimeZone`, or `'UTC'` when the org keeps no books yet. */
  timeZone: string
  /** Captured once, so every bucket judges "in the future" against the same instant. */
  now: Date
  /**
   * This run's number, stamped onto every build it raises
   * (plans/money/tasks/45 §3).
   *
   * 🛑 **Allocated ONCE, here, and passed down.** `recordNumbering.create`
   * increments a counter, so allocating it inside the bucket loop would burn the
   * sequence and give every build its own run: a four-hundred-build backfill
   * would produce four hundred runs, and undo, whose whole input is one run
   * number, would have nothing to hang on.
   */
  batchRun: number
}

/**
 * Write every build a {@link BackfillPlan} calls for.
 *
 * One bucket becomes one build, `source: 'batch'`, carrying the bucket's demand
 * period rather than its orders (section 6.2). When `request.status` is
 * `completed` the build is then started and completed at its period date.
 *
 * ⚠️ **Every raised build appears in `created`, including one whose completion
 * was refused** — that build exists, and `created.length` is therefore the
 * answer to "how many builds does this org now have that it did not before".
 * `leftInProgress` flags the subset that needs a person, and its entries are
 * also in `created`.
 *
 * @param plan what to build, from `planBackfill`. Parts ascending, buckets
 *   chronological; this executes them in exactly that order.
 * @param request what the dialog was asked for. Only `status` changes what is
 *   written — the range and grouping are already baked into the plan's buckets.
 * @returns a summary, never a throw. `err` is reserved for the refusals that
 *   write NOTHING AT ALL: no build entity, no demand-period fields.
 */
export async function executeBackfill(
  db: Database,
  organizationId: string,
  userId: string,
  plan: BackfillPlan,
  request: BackfillRequest
): Promise<Result<BackfillRunSummary, Error>> {
  return guard(
    async () => {
      const summary: MutableRunSummary = {
        batchRun: null,
        created: [],
        leftInProgress: [],
        failed: [],
      }
      // 🛑 BEFORE `prepareRun`, deliberately: an empty plan writes no build, so
      // it must burn no run number (plans/money/tasks/45 §3.2). A counter that
      // skips a number every time somebody previews an empty range is the
      // "run 14 in an org with zero builds" mismatch §10.6 is already about.
      // Asserted by a test.
      if (plan.parts.length === 0) return summary

      const run = await prepareRun(organizationId)
      summary.batchRun = run.batchRun
      let written = 0

      for (const part of plan.parts) {
        const attempted = new Set<string>()
        try {
          for (const bucket of part.buckets) {
            attempted.add(bucket.bucketId)
            // 🛑 One refused bucket must not lose the rest of the part.
            try {
              await executeBucket(db, organizationId, userId, run, bucket, request, summary)
            } catch (error) {
              recordFailure(summary, bucket, error)
            }
            written += 1
            if (written % PROGRESS_EVERY === 0) {
              logger.info('Backfilling builds', { organizationId, written, of: plan.buildCount })
            }
          }
        } catch (error) {
          // 🛑 One bad part must not lose the run. Only the buckets this part
          // never reached are recorded — the ones it did have a row already, and
          // a second one would report the same bucket failing twice.
          const message = error instanceof Error ? error.message : String(error)
          for (const bucket of part.buckets) {
            if (attempted.has(bucket.bucketId)) continue
            summary.failed.push({
              partId: part.partId,
              bucketId: bucket.bucketId,
              periodKey: bucket.periodKey,
              reason: message,
            })
          }
          logger.error('Backfilling one part failed; continuing with the run', {
            organizationId,
            partId: part.partId,
            message,
          })
        }
      }

      logger.info('Backfilled builds', {
        organizationId,
        batchRun: run.batchRun,
        status: request.status,
        grouping: request.grouping,
        planned: plan.buildCount,
        created: summary.created.length,
        leftInProgress: summary.leftInProgress.length,
        failed: summary.failed.length,
      })

      return summary
    },
    'Backfilling builds failed',
    { organizationId, buckets: plan.buildCount, status: request.status }
  )
}

/**
 * THE accounting date for one bucket, derived from the demand it covers.
 *
 * The period is half-open — `periodStart` inclusive, `periodEnd` exclusive — and
 * `build_completed_at` must land INSIDE it, so this takes the end of the last
 * calendar day the period contains, in the book timezone. A monthly bucket for
 * January in `America/New_York` therefore completes at 23:59:59.999 on
 * January 31 local, which is February 1 05:59 UTC: derive that in UTC instead
 * and the build posts to the wrong month, invisibly, and uncorrectably once the
 * period is locked. Same rule, same reason, as `postings/periods.ts`.
 *
 * Clamped into `[periodStart, periodEnd)` afterwards, so a boundary that was
 * computed in a different zone from the one read here can still only produce an
 * instant the build's own period contains. Under `grouping: 'order'` the two
 * bounds collapse onto the one order's date and the clamp returns `periodStart`,
 * which is that date.
 *
 * @param timeZone `accounting.bookTimeZone`. `'UTC'` is correct only for an
 *   organization whose boundaries are already normalized to it.
 */
export function resolveBackfillCompletedAt(bucket: BackfillBucket, timeZone: string): Date {
  const startMs = bucket.periodStart.getTime()
  const endMs = bucket.periodEnd.getTime()
  if (!Number.isFinite(startMs)) {
    throw new UnprocessableEntityError('This build period has no usable start date')
  }
  const lastMs = Number.isFinite(endMs) && endMs > startMs ? endMs - 1 : startMs

  const localDay = periodKeyForDate(new Date(lastMs), 'day', timeZone)
  const endOfLocalDay = fromZonedTime(`${localDay}T23:59:59.999`, timeZone)
  const candidate = Number.isNaN(endOfLocalDay.getTime()) ? lastMs : endOfLocalDay.getTime()

  return new Date(Math.min(Math.max(candidate, startMs), lastMs))
}

/**
 * Resolve the run's ambient facts, and refuse before writing anything.
 *
 * 🛑 **The two demand-period fields are required, not optional.** `createBuild`
 * writes them only when the build entity carries them and otherwise raises the
 * build regardless, which is the right call for one build and the wrong shape
 * for four hundred: a batch build with no period is invisible to the netting
 * read that decides what the NEXT run owes (section 6.2), so an unprovisioned
 * org would get the whole range built and then get it all built again on the
 * second pass. Refusing here writes nothing; discovering it on build one has
 * already written one.
 *
 * ⚠️ **`build_batch_run` is NOT required, and deliberately so.** The asymmetry
 * with the two fields above is the point: coverage depends on the period, so a
 * run without it computes the wrong thing; nothing about the netting depends on
 * the run number, so an org short of entity migration 141 gets un-numbered
 * builds and a correct backfill. What it loses is undo, which is worth a warning
 * and not a refusal (plans/money/tasks/45 §3).
 */
async function prepareRun(organizationId: string): Promise<RunContext> {
  const [fields, timeZone] = await Promise.all([
    getOrgCache()
      .from(organizationId, 'customFields')
      .bySystemAttributes(['build_period_start', 'build_period_end', 'build_batch_run'] as const),
    readBookTimeZone(organizationId),
  ])

  if (!fields.build_period_start || !fields.build_period_end) {
    throw new UnprocessableEntityError(
      'Backfilling builds is not available until the build demand-period fields are provisioned'
    )
  }

  if (!fields.build_batch_run) {
    logger.warn('This organization has no build_batch_run field, so the run will be un-numbered', {
      organizationId,
    })
  }

  // 🛑 ONCE per run, here, which is the single place everything for a run is
  // resolved (plans/money/tasks/45 §3.2). `recordNumbering.create` is an atomic
  // `UPDATE ... RETURNING`, so two concurrent runs can never share a number; the
  // failure this placement prevents is the other one, allocating inside the
  // bucket loop, which would burn the sequence and give every build its own run.
  // `sequenceNumber` is the raw integer `build_batch_run` stores. The formatted
  // `recordNumber` is cosmetic and nothing renders it.
  const { sequenceNumber } = await recordNumbering.create(organizationId, 'build_batch')

  return { timeZone, now: new Date(), batchRun: sequenceNumber }
}

/** Raise one bucket's build, and complete it when the run was asked to. */
async function executeBucket(
  db: Database,
  organizationId: string,
  userId: string,
  run: RunContext,
  bucket: BackfillBucket,
  request: BackfillRequest,
  summary: MutableRunSummary
): Promise<void> {
  // Derived BEFORE anything is written: a bucket that cannot be dated must not
  // leave a raised build behind, and section 7.3's first rule is that completing
  // demand that has not happened yet is meaningless.
  let completedAt: Date | undefined
  if (request.status === 'completed') {
    completedAt = resolveBackfillCompletedAt(bucket, run.timeZone)
    if (completedAt.getTime() > run.now.getTime()) {
      throw new UnprocessableEntityError(
        `The ${bucket.periodKey} demand period has not ended yet, so its build cannot be completed`
      )
    }
  }

  // 🛑 The period and the run number go in HERE or never: `createBuild` is the
  // only writer of `build_period_start`, `build_period_end` and
  // `build_batch_run`, because moving a claimed period silently restates what
  // the next netting run believes is already covered (section 6.2) and moving a
  // run number silently rewrites what an undo would touch
  // (plans/money/tasks/45 §3). All three are written at create time and ignored
  // unless the source is `batch`.
  //
  // `run.batchRun` and never a fresh allocation: every bucket in this run passes
  // the SAME number, which is what makes "the builds run 2 made" a plain filter.
  const created = await createBuild(db, organizationId, userId, {
    partId: bucket.partId,
    quantityPlanned: bucket.quantityToBuild,
    source: 'batch',
    period: { start: bucket.periodStart, end: bucket.periodEnd },
    batchRun: run.batchRun,
  })
  // A refused raise wrote nothing at all, so it is a `failed` bucket rather than
  // a build somebody has to go and finish. Thrown, not returned, so the bucket
  // layer records it and the run steps over it.
  if (created.isErr()) throw created.error
  const build = created.value

  summary.created.push({
    partId: bucket.partId,
    buildId: build.buildId,
    quantity: bucket.quantityToBuild,
    periodKey: bucket.periodKey,
  })

  if (request.status === 'planned' || !completedAt) return

  const started = await startBuild(db, organizationId, userId, { buildId: build.buildId })
  if (started.isErr()) {
    recordLeftInProgress(
      summary,
      bucket,
      build.buildId,
      `The build was raised but could not be started: ${started.error.message}`
    )
    return
  }

  const completed = await completeBuild(db, organizationId, userId, {
    buildId: build.buildId,
    quantityProduced: bucket.quantityToBuild,
    completedAt,
  })
  if (completed.isErr()) {
    // The refusal verbatim — an unpriced component, almost always — because it
    // is what the person has to go and fix.
    recordLeftInProgress(summary, bucket, build.buildId, completed.error.message)
  }
}

/** `accounting.bookTimeZone`, or `'UTC'` for an org that keeps no books yet. */
async function readBookTimeZone(organizationId: string): Promise<string> {
  const value = await getOrganizationSetting({
    organizationId,
    key: OPENING_BASELINE_SETTING_KEYS.bookTimeZone,
  })
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : 'UTC'
}

/**
 * A build that exists and needs a person.
 *
 * 🛑 NOT `failed`, whose contract is "buckets that produced nothing at all".
 * The distinction is the whole of section 7.4: this build is in the builds list
 * and somebody has to complete or cancel it, and reporting it as a failure is
 * what makes them run the backfill again and raise a duplicate.
 */
function recordLeftInProgress(
  summary: MutableRunSummary,
  bucket: BackfillBucket,
  buildId: string,
  reason: string
): void {
  summary.leftInProgress.push({ partId: bucket.partId, buildId, reason })
  logger.warn('A backfilled build was raised but not completed', {
    partId: bucket.partId,
    periodKey: bucket.periodKey,
    buildId,
    reason,
  })
}

/** One bucket that wrote nothing, recorded and stepped over. */
function recordFailure(summary: MutableRunSummary, bucket: BackfillBucket, error: unknown): void {
  const reason = error instanceof Error ? error.message : String(error)
  summary.failed.push({
    partId: bucket.partId,
    bucketId: bucket.bucketId,
    periodKey: bucket.periodKey,
    reason,
  })
  logger.error('A backfill bucket failed; continuing with the run', {
    partId: bucket.partId,
    bucketId: bucket.bucketId,
    periodKey: bucket.periodKey,
    reason,
  })
}
