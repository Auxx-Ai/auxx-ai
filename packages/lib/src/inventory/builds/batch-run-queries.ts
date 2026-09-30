// packages/lib/src/inventory/builds/batch-run-queries.ts

/**
 * What a batch run looks like from outside. A run is not a record: it is the `batchRun` number
 * stamped on every build one run raised, folded here (plans/money/tasks/45-batch-only-builds.md §3.1,
 * §10.4). Reads only; the write is `undo-batch-run.ts`.
 */

import { type Database, schema } from '@auxx/database'
import { and, asc, desc, eq, exists, isNotNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Result } from 'neverthrow'
import type { BuildStatusValue } from './client'
import { guard } from './guard'
import type { BatchRunSummary } from './types'

/** One build inside a run, at the columns an undo or a count needs. */
export interface BatchRunBuild {
  buildId: string
  runNumber: number
  status: BuildStatusValue
  partId: string
  /** Another build already reverses this one, so `reverseBuild` would refuse it. */
  alreadyReversed: boolean
  /** This build IS a reversal. Never true in practice: a reversal carries no `batchRun`. */
  isReversal: boolean
  periodStart: Date | null
  periodEnd: Date | null
  createdAt: Date
}

/** The counts for one run. A number no build carries is an empty summary, never a `NotFoundError`. */
export async function readBatchRun(
  db: Database,
  organizationId: string,
  runNumber: number
): Promise<Result<BatchRunSummary, Error>> {
  return guard(
    async () => {
      const [summary] = await queryBatchRunSummaries(db, organizationId, runNumber)
      return summary ?? emptySummary(runNumber)
    },
    'Failed to read a batch run',
    { organizationId, runNumber }
  )
}

/** Every run this organization has, highest (latest allocated) run number first. */
export async function listBatchRuns(
  db: Database,
  organizationId: string
): Promise<Result<BatchRunSummary[], Error>> {
  return guard(
    async () => queryBatchRunSummaries(db, organizationId, null),
    'Failed to list batch runs',
    { organizationId }
  )
}

/** The builds one run raised, oldest first, so an interrupted undo has undone a prefix. */
export async function readBatchRunBuilds(
  db: Database,
  organizationId: string,
  runNumber: number
): Promise<Result<BatchRunBuild[], Error>> {
  return guard(
    async () => {
      const b = schema.Build
      const rows = await db
        .select({
          buildId: b.id,
          runNumber: b.batchRun,
          status: b.status,
          partId: b.partId,
          reversalOfBuildId: b.reversalOfBuildId,
          alreadyReversed: reversedExists(db, organizationId),
          periodStart: b.periodStart,
          periodEnd: b.periodEnd,
          createdAt: b.createdAt,
        })
        .from(b)
        .where(and(eq(b.organizationId, organizationId), eq(b.batchRun, runNumber)))
        .orderBy(asc(b.createdAt), asc(b.id))
      return rows.map((row) => ({
        buildId: row.buildId,
        runNumber: row.runNumber ?? runNumber,
        status: row.status,
        partId: row.partId,
        alreadyReversed: Boolean(row.alreadyReversed),
        isReversal: row.reversalOfBuildId != null,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        createdAt: row.createdAt,
      }))
    },
    'Failed to read the builds of a batch run',
    { organizationId, runNumber }
  )
}

/** `EXISTS` a build whose `reversalOfBuildId` names the outer `Build` row. */
function reversedExists(db: Database, organizationId: string) {
  const reversal = alias(schema.Build, 'batch_run_reversal')
  return exists(
    db
      .select({ one: sql`1` })
      .from(reversal)
      .where(
        and(
          eq(reversal.organizationId, organizationId),
          eq(reversal.reversalOfBuildId, schema.Build.id)
        )
      )
  ).mapWith(Boolean)
}

/** One `GROUP BY batchRun` over the table; `runNumber` null reads every run. */
async function queryBatchRunSummaries(
  db: Database,
  organizationId: string,
  runNumber: number | null
): Promise<BatchRunSummary[]> {
  const b = schema.Build
  const count = (where: ReturnType<typeof sql>) =>
    sql<number>`count(*) filter (where ${where})`.mapWith(Number)
  // `willReverse` is the count that writes to the ledger, so it excludes builds already reversed.
  const reversible = sql`${b.status} = 'completed' and ${b.reversalOfBuildId} is null and not ${reversedExists(db, organizationId)}`

  const rows = await db
    .select({
      runNumber: b.batchRun,
      total: sql<number>`count(*)`.mapWith(Number),
      planned: count(sql`${b.status} = 'planned'`),
      inProgress: count(sql`${b.status} = 'in_progress'`),
      completed: count(sql`${b.status} = 'completed'`),
      canceled: count(sql`${b.status} = 'canceled'`),
      willReverse: count(reversible),
      periodStart: sql<Date | null>`min(${b.periodStart})`.mapWith(b.periodStart),
      periodEnd: sql<Date | null>`max(${b.periodEnd})`.mapWith(b.periodEnd),
      ranAt: sql<Date | null>`min(${b.createdAt})`.mapWith(b.createdAt),
    })
    .from(b)
    .where(
      and(
        eq(b.organizationId, organizationId),
        runNumber == null ? isNotNull(b.batchRun) : eq(b.batchRun, runNumber)
      )
    )
    .groupBy(b.batchRun)
    .orderBy(desc(b.batchRun))

  return rows.map((row) => ({
    runNumber: row.runNumber ?? runNumber ?? 0,
    total: row.total,
    planned: row.planned,
    inProgress: row.inProgress,
    completed: row.completed,
    canceled: row.canceled,
    willCancel: row.planned + row.inProgress,
    willReverse: row.willReverse,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    ranAt: row.ranAt,
  }))
}

function emptySummary(runNumber: number): BatchRunSummary {
  return {
    runNumber,
    total: 0,
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
}
