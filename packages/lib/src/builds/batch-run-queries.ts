// packages/lib/src/builds/batch-run-queries.ts

/**
 * What a batch RUN looks like from outside.
 *
 * `plans/money/tasks/45-batch-only-builds.md` sections 4, 10.4 and 11.3.
 *
 * ⚠️ **A run is not a record** (45 section 3.1). It is a scalar,
 * `build_batch_run`, stamped on every build one run raised, and everything a
 * `batch_run` entity would have stored is recoverable from those builds: the
 * range off `build_period_start` / `build_period_end`, the statuses off
 * `build_status`, the timing off `EntityInstance.createdAt`. This file is the
 * recovery, and section 10.4 is the note that nobody had costed it: the Undo
 * action takes a run number as INPUT, so without these reads there is no
 * surface that can name one.
 *
 * Two reads:
 *
 * - {@link readBatchRun}, the counts for ONE run. The drawer card and the undo
 *   preview render it, and 45 section 11.3 is explicit that this is the read
 *   the feature cannot ship without.
 * - {@link listBatchRuns}, every run this org has, newest first.
 *
 * plus {@link readBatchRunBuilds}, the per-build rows both of those fold, which
 * `undo-batch-run.ts` also loads because it acts on exactly the same set.
 *
 * ## 🛑 `willReverse` counts what is NOT already reversed
 *
 * `willCancel` and `willReverse` are two different numbers and the second is
 * the one that WRITES TO THE LEDGER (45 section 11.4), so the confirmation has
 * to lead with both. A `completed` build that some live build already points its
 * `build_reversal_of` at needs nothing from an undo: `reverseBuild` would refuse
 * it, and counting it would promise a ledger write that never happens. So the
 * incoming reversal edge is LEFT JOINed and asserted absent, the same shape
 * `hasBuildReversal` uses for one build and the same shape
 * `backfill-queries.ts` uses to keep reversals out of coverage.
 *
 * ## Why the fold is in TypeScript
 *
 * One query per call, and the counting happens over the rows. A run is bounded
 * by the buckets one backfill produced (45 section 10.2: a whole-range monthly
 * run is on the order of a thousand), and the rows are narrow. Conditional
 * aggregates in SQL would buy nothing here and would put the `willReverse` rule
 * somewhere no unit test can read it.
 *
 * Reads only, and no permission checks: the router asserts
 * (`docs/lib-module-guide.md` section 6). The write is `undo-batch-run.ts`.
 */

import { type Database, schema } from '@auxx/database'
import { and, eq, isNotNull, isNull, type SQL } from 'drizzle-orm'
import { type AnyPgColumn, alias } from 'drizzle-orm/pg-core'
import type { Result } from 'neverthrow'
import { loadBuildFieldContext } from './build-queries'
import { type BuildStatusValue, resolveBuildStatus } from './client'
import { guard } from './guard'
import type { BatchRunSummary } from './types'

/**
 * One build inside a run, at the fields an undo or a count needs.
 *
 * Deliberately narrower than a `BuildRecord`: nothing here reads a cost or a
 * quantity, and hydrating the full row for a thousand builds would be a page of
 * `FieldValue` per build for six columns nobody looks at.
 */
export interface BatchRunBuild {
  buildId: string
  /** The run that raised it. Never `null` here: it is what selected the row. */
  runNumber: number
  /** `null` on a row whose status value is missing, which is never defaulted. */
  status: BuildStatusValue | null
  partId: string | null
  /**
   * A LIVE build already points its `build_reversal_of` at this one, so it has
   * been undone and `reverseBuild` would refuse it (`reverse-build.ts` step 2).
   * An ARCHIVED reversal does not count, for the reason `hasBuildReversal`
   * gives: it contributes to no roll-up, so treating it as a standing reversal
   * would leave the mistake uncorrectable.
   */
  alreadyReversed: boolean
  /**
   * This build IS a reversal.
   *
   * 🛑 Always `false` in practice, and read anyway. `reversalBuildValues` must
   * not copy `build_batch_run` onto a reversal (45 section 4.1), which is what
   * `__tests__/reverse-build-batch-run.test.ts` pins: if it ever did, run N
   * would contain its own undo and this flag is what stops a second undo
   * reversing the reversals.
   */
  isReversal: boolean
  periodStart: Date | null
  periodEnd: Date | null
  createdAt: Date
}

/** An aliased `FieldValue` table, as `alias()` returns it. */
type FieldValueAlias = ReturnType<typeof alias<typeof schema.FieldValue, string>>

/**
 * The counts for ONE run.
 *
 * ⚠️ **A run number that matches no build is an EMPTY summary, never a
 * `NotFoundError`** (45 section 10.8). A run whose buckets all failed allocated
 * a number that no build carries, and so does an org that is short of the
 * migration provisioning `build_batch_run`. Both are honest zeroes, and both
 * would be a 404 that a person reads as "your data is missing".
 */
export async function readBatchRun(
  db: Database,
  organizationId: string,
  runNumber: number
): Promise<Result<BatchRunSummary, Error>> {
  return guard(
    async () => {
      const builds = await queryBatchRunBuilds(db, organizationId, runNumber)
      return summarize(runNumber, builds)
    },
    'Failed to read a batch run',
    { organizationId, runNumber }
  )
}

/**
 * Every run this organization has, newest first.
 *
 * Newest is the HIGHEST run number rather than the latest `createdAt`: the
 * number comes from an atomic counter, so it orders the runs by when they were
 * allocated even when two ran close enough together to share a second.
 */
export async function listBatchRuns(
  db: Database,
  organizationId: string
): Promise<Result<BatchRunSummary[], Error>> {
  return guard(
    async () => {
      const builds = await queryBatchRunBuilds(db, organizationId, null)

      const byRun = new Map<number, BatchRunBuild[]>()
      for (const build of builds) {
        const bucket = byRun.get(build.runNumber)
        if (bucket) bucket.push(build)
        else byRun.set(build.runNumber, [build])
      }

      return [...byRun.entries()]
        .sort(([left], [right]) => right - left)
        .map(([runNumber, runBuilds]) => summarize(runNumber, runBuilds))
    },
    'Failed to list batch runs',
    { organizationId }
  )
}

/**
 * The builds one run raised, as the undo acts on them.
 *
 * Ordered oldest first, so an interrupted undo has undone a prefix of the run
 * rather than an arbitrary subset of it.
 */
export async function readBatchRunBuilds(
  db: Database,
  organizationId: string,
  runNumber: number
): Promise<Result<BatchRunBuild[], Error>> {
  return guard(
    async () => queryBatchRunBuilds(db, organizationId, runNumber),
    'Failed to read the builds of a batch run',
    { organizationId, runNumber }
  )
}

/**
 * ONE query: every build carrying a run number, or carrying THIS one.
 *
 * An org with no `build` definition, or one short of the migration that
 * provisions `build_batch_run`, reads as no builds rather than as an error. It
 * has never run a batch, so "no runs" is the true answer and a refusal would
 * only stop a drawer from rendering.
 */
async function queryBatchRunBuilds(
  db: Database,
  organizationId: string,
  runNumber: number | null
): Promise<BatchRunBuild[]> {
  const ctx = await loadBuildFieldContext(organizationId)
  const runField = ctx?.fields.build_batch_run
  if (!ctx || !runField) return []

  const runValue = alias(schema.FieldValue, 'batch_run_v')
  const statusValue = alias(schema.FieldValue, 'batch_run_status_v')
  const partValue = alias(schema.FieldValue, 'batch_run_part_v')
  const reversalOfValue = alias(schema.FieldValue, 'batch_run_reversal_of_v')
  const periodStartValue = alias(schema.FieldValue, 'batch_run_period_start_v')
  const periodEndValue = alias(schema.FieldValue, 'batch_run_period_end_v')
  // The INCOMING edge: some other build naming this one as what it reverses.
  const reversedByValue = alias(schema.FieldValue, 'batch_run_reversed_by_v')
  const reversedByInstance = alias(schema.EntityInstance, 'batch_run_reversed_by_ei')

  const reversalFieldId = fieldId(ctx.fields.build_reversal_of)

  const rows = await db
    .select({
      buildId: schema.EntityInstance.id,
      createdAt: schema.EntityInstance.createdAt,
      runNumber: runValue.valueNumber,
      status: statusValue.optionId,
      partId: partValue.relatedEntityId,
      reversalOfBuildId: reversalOfValue.relatedEntityId,
      reversedByBuildId: reversedByInstance.id,
      periodStart: periodStartValue.valueDate,
      periodEnd: periodEndValue.valueDate,
    })
    .from(schema.EntityInstance)
    .innerJoin(
      runValue,
      and(
        ownValue(runValue, schema.EntityInstance.id, organizationId, runField.id),
        isNotNull(runValue.valueNumber),
        // A run number of `null` selects every run; a number selects one. Both
        // are the same query, so the two reads cannot drift apart.
        ...(runNumber == null ? [] : [eq(runValue.valueNumber, runNumber)])
      )
    )
    .leftJoin(
      statusValue,
      ownValue(
        statusValue,
        schema.EntityInstance.id,
        organizationId,
        fieldId(ctx.fields.build_status)
      )
    )
    .leftJoin(
      partValue,
      ownValue(partValue, schema.EntityInstance.id, organizationId, fieldId(ctx.fields.build_part))
    )
    .leftJoin(
      reversalOfValue,
      ownValue(reversalOfValue, schema.EntityInstance.id, organizationId, reversalFieldId)
    )
    .leftJoin(
      periodStartValue,
      ownValue(
        periodStartValue,
        schema.EntityInstance.id,
        organizationId,
        fieldId(ctx.fields.build_period_start)
      )
    )
    .leftJoin(
      periodEndValue,
      ownValue(
        periodEndValue,
        schema.EntityInstance.id,
        organizationId,
        fieldId(ctx.fields.build_period_end)
      )
    )
    // 🛑 The reversal edge read BACKWARDS, which is what `willReverse` turns on.
    // A LEFT JOIN plus `IS NULL`, so a build nothing has reversed is kept
    // alongside one whose reversal is archived; an inner join would keep exactly
    // the builds an undo has nothing to do with.
    .leftJoin(
      reversedByValue,
      and(
        eq(reversedByValue.organizationId, organizationId),
        eq(reversedByValue.fieldId, reversalFieldId),
        eq(reversedByValue.relatedEntityId, schema.EntityInstance.id)
      )
    )
    .leftJoin(
      reversedByInstance,
      and(
        eq(reversedByInstance.id, reversedByValue.entityId),
        eq(reversedByInstance.organizationId, organizationId),
        isNull(reversedByInstance.archivedAt)
      )
    )
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, ctx.buildDefId),
        isNull(schema.EntityInstance.archivedAt)
      )
    )

  // Keyed by build id, because the backwards join fans out: a build with two
  // reversals (which nothing should ever write) would otherwise be counted
  // twice, and `total` is a number a person reconciles against a list.
  const builds = new Map<string, BatchRunBuild>()
  for (const row of rows) {
    if (!row.buildId) continue
    const run = row.runNumber == null ? Number.NaN : Number(row.runNumber)
    if (!Number.isFinite(run)) continue

    const existing = builds.get(row.buildId)
    if (existing) {
      // Only ever widens: one reversal row is enough to say the build is undone.
      if (row.reversedByBuildId) existing.alreadyReversed = true
      continue
    }

    builds.set(row.buildId, {
      buildId: row.buildId,
      runNumber: run,
      status: resolveBuildStatus(row.status),
      partId: row.partId ?? null,
      alreadyReversed: Boolean(row.reversedByBuildId),
      isReversal: Boolean(row.reversalOfBuildId),
      periodStart: toDate(row.periodStart),
      periodEnd: toDate(row.periodEnd),
      createdAt: row.createdAt,
    })
  }

  return [...builds.values()].sort(
    (left, right) => left.createdAt.getTime() - right.createdAt.getTime()
  )
}

/**
 * Fold one run's builds into the shape the card renders.
 *
 * 🛑 `willReverse` is `completed` MINUS the already-reversed, never
 * `summary.completed`. The two are the same number only on a run nobody has
 * touched, and the moment they differ the larger one is a promise of ledger
 * writes that will not happen.
 */
function summarize(runNumber: number, builds: BatchRunBuild[]): BatchRunSummary {
  const summary: BatchRunSummary = {
    runNumber,
    total: builds.length,
    planned: 0,
    inProgress: 0,
    completed: 0,
    canceled: 0,
    willCancel: 0,
    willReverse: 0,
    periodStart: null,
    periodEnd: null,
    ranAt: null,
  }

  for (const build of builds) {
    if (build.status === 'planned') summary.planned += 1
    else if (build.status === 'in_progress') summary.inProgress += 1
    else if (build.status === 'completed') summary.completed += 1
    else if (build.status === 'canceled') summary.canceled += 1

    if (build.status === 'planned' || build.status === 'in_progress') summary.willCancel += 1
    if (build.status === 'completed' && !build.alreadyReversed && !build.isReversal) {
      summary.willReverse += 1
    }

    summary.periodStart = earlier(summary.periodStart, build.periodStart)
    summary.periodEnd = later(summary.periodEnd, build.periodEnd)
    summary.ranAt = earlier(summary.ranAt, build.createdAt)
  }

  return summary
}

function earlier(current: Date | null, candidate: Date | null): Date | null {
  if (!candidate) return current
  if (!current) return candidate
  return candidate.getTime() < current.getTime() ? candidate : current
}

function later(current: Date | null, candidate: Date | null): Date | null {
  if (!candidate) return current
  if (!current) return candidate
  return candidate.getTime() > current.getTime() ? candidate : current
}

/**
 * Join predicate for "this instance's value of <field>".
 *
 * Takes the alias OBJECT and composes with `eq`, so drizzle emits the table as
 * an identifier. A hand-written `sql` fragment interpolating a table binds it as
 * a parameter instead, which is a mistake this codebase has already paid for
 * (`build-queries.ts`).
 */
function ownValue(
  value: FieldValueAlias,
  ownerId: AnyPgColumn,
  organizationId: string,
  fieldId: string
): SQL | undefined {
  return and(
    eq(value.entityId, ownerId),
    eq(value.organizationId, organizationId),
    eq(value.fieldId, fieldId)
  )
}

/**
 * A materialised field's id, or a sentinel that matches no row.
 *
 * Every field reached through it is on a LEFT JOIN, so joining on an id that
 * cannot exist gives exactly the behaviour an unmaterialised field should have:
 * the column reads `null`. `build_batch_run` itself is required above rather
 * than defaulted, because its absence would WIDEN the answer to every build in
 * the org. Same rule, same reason, as `backfill-queries.ts`.
 */
function fieldId(field: { id: string } | null | undefined): string {
  return field?.id ?? '__unmaterialised__'
}

/**
 * Read a date column back as a `Date`.
 *
 * `FieldValue.valueDate` is declared `mode: 'string'`, and an unparseable value
 * is `null` rather than an Invalid Date: an Invalid Date compares false against
 * everything, so it would silently vanish from the period arithmetic much later.
 */
function toDate(value: string | Date | null | undefined): Date | null {
  if (value == null) return null
  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}
