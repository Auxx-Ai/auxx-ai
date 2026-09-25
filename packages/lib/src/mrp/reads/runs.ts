// packages/lib/src/mrp/reads/runs.ts

import { type Database, schema } from '@auxx/database'
import { type DayKey, dayKeyInZone } from '@auxx/utils/calendar-day'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { readBookTimeZoneOrUtc } from '../../accounting/ledger/setup/book-time-zone'
import { NotFoundError } from '../../errors'
import { guard } from './guard'

const R = schema.MrpPlanRun
const I = schema.MrpPlanRunItem

/** One stored `MrpPlanRunItem` row. */
export type MrpPlanItemRow = typeof schema.MrpPlanRunItem.$inferSelect

/** The run a read answers from; `asOfDay` is `asOf` in the book zone, the day tabs and cover count from. */
export interface MrpRunRef {
  id: string
  asOf: Date
  asOfDay: DayKey
  startedAt: Date
  finishedAt: Date | null
  params: unknown
  zone: string
}

export interface MrpRunListRow {
  id: string
  status: 'running' | 'completed' | 'failed'
  asOf: Date
  startedAt: Date
  finishedAt: Date | null
  durationMs: number | null
  error: string | null
  params: unknown
  itemCount: number
  overdueCount: number
  flaggedCount: number
  /** The completed run every other read defaults to. */
  isLatest: boolean
}

const DEFAULT_RUN_LIMIT = 50

/** The latest completed run, or `runId`'s; throws `NotFoundError` for another org's run or one not completed. Null when the org has none yet. */
export async function loadRun(
  db: Database,
  organizationId: string,
  runId?: string | null
): Promise<MrpRunRef | null> {
  const [row] = await db
    .select()
    .from(R)
    .where(
      and(
        eq(R.organizationId, organizationId),
        eq(R.status, 'completed'),
        runId ? eq(R.id, runId) : undefined
      )
    )
    .orderBy(desc(R.finishedAt), desc(R.startedAt))
    .limit(1)
  if (!row) {
    if (runId) throw new NotFoundError('Plan run not found')
    return null
  }
  const zone = await readBookTimeZoneOrUtc(organizationId)
  return {
    id: row.id,
    asOf: row.asOf,
    asOfDay: dayKeyInZone(row.asOf, zone),
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    params: row.params,
    zone,
  }
}

/** {@link loadRun} as a `Result`, for the router's run picker. */
export async function resolveRun(
  db: Database,
  organizationId: string,
  runId?: string | null
): Promise<Result<MrpRunRef | null, Error>> {
  return guard(() => loadRun(db, organizationId, runId), 'Failed to resolve the plan run', {
    organizationId,
    runId,
  })
}

/** Runs newest first, with their item, overdue and flagged counts (07 §4.4). */
export async function listRuns(
  db: Database,
  organizationId: string,
  input: { limit?: number } = {}
): Promise<Result<MrpRunListRow[], Error>> {
  return guard(
    async () => {
      const runs = await db
        .select()
        .from(R)
        .where(eq(R.organizationId, organizationId))
        .orderBy(desc(R.startedAt))
        .limit(input.limit ?? DEFAULT_RUN_LIMIT)
      if (runs.length === 0) return []

      const counts = await db
        .select({
          runId: I.mrpPlanRunId,
          items: sql<number>`count(*)::int`,
          overdue: sql<number>`count(*) filter (where ${I.isOverdue})::int`,
          flagged: sql<number>`count(*) filter (where cardinality(${I.flags}) > 0)::int`,
        })
        .from(I)
        .where(
          and(
            eq(I.organizationId, organizationId),
            inArray(
              I.mrpPlanRunId,
              runs.map((run) => run.id)
            )
          )
        )
        .groupBy(I.mrpPlanRunId)
      const byRun = new Map(counts.map((c) => [c.runId, c]))
      const latest = await loadRun(db, organizationId)

      return runs.map((run) => {
        const c = byRun.get(run.id)
        return {
          id: run.id,
          status: run.status,
          asOf: run.asOf,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          durationMs: run.finishedAt ? run.finishedAt.getTime() - run.startedAt.getTime() : null,
          error: run.error,
          params: run.params,
          itemCount: c?.items ?? 0,
          overdueCount: c?.overdue ?? 0,
          flaggedCount: c?.flagged ?? 0,
          isLatest: run.id === latest?.id,
        }
      })
    },
    'Failed to list plan runs',
    { organizationId }
  )
}
