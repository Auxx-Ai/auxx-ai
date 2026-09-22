// packages/lib/src/accounting/work-items/sweep.ts

import { type Database, schema } from '@auxx/database'
import { and, asc, eq, lte, min, sql } from 'drizzle-orm'
import type { WorkItemStage } from './codes'
import { refusalFromError } from './refusal'
import { upsertWorkItem } from './write'

/** Rows at a stage whose `nextAttemptAt` has come, oldest schedule first, capped. */
export async function listDueWorkItems(
  db: Database,
  organizationId: string,
  input: { stage: WorkItemStage; sourceKind: string; limit: number; now?: Date }
): Promise<string[]> {
  if (input.limit <= 0) return []
  const t = schema.AccountingWorkItem
  const rows = await db
    .select({ sourceId: t.sourceId })
    .from(t)
    .where(
      and(
        eq(t.organizationId, organizationId),
        eq(t.stage, input.stage),
        eq(t.sourceKind, input.sourceKind),
        lte(t.nextAttemptAt, input.now ?? new Date())
      )
    )
    .orderBy(asc(t.nextAttemptAt), asc(t.id))
    .limit(input.limit)
  return rows.map((row) => row.sourceId)
}

/** `NOT EXISTS` a row for this source at this stage - what "never tried" means in a candidate query. */
export function noWorkItem(
  organizationId: string,
  input: { stage: WorkItemStage; sourceKind: string; sourceId: unknown }
) {
  return sql`NOT EXISTS (SELECT 1 FROM ${schema.AccountingWorkItem} item
    WHERE item."organizationId" = ${organizationId}
      AND item."sourceKind" = ${input.sourceKind}
      AND item."stage" = ${input.stage}
      AND item."sourceId" = ${input.sourceId})`
}

export interface SweepCounts {
  scanned: number
  accepted: number
  blocked: number
  skipped: number
  [status: string]: number
}

/**
 * The one sweep frame: never-tried sources first, then due rows, until `limit` or the
 * time budget. A thousand refusals cannot starve a postable source, because a refusal
 * reschedules its own row and a never-tried source is never behind one.
 */
export async function runWorkItemSweep(
  db: Database,
  input: {
    organizationId: string
    stage: WorkItemStage
    sourceKind: string
    limit: number
    timeBudgetMs?: number
    /** Never-tried candidates; must exclude sources that already hold a row at this stage. */
    listFresh: (limit: number) => Promise<string[]>
    /** Offer one source to its poster; a throw counts as blocked and the page moves on. */
    handle: (sourceId: string) => Promise<{ status: string }>
  }
): Promise<SweepCounts> {
  const started = Date.now()
  const limit = Math.min(Math.max(input.limit, 1), 500)
  const fresh = await input.listFresh(limit)
  const due = await listDueWorkItems(db, input.organizationId, {
    stage: input.stage,
    sourceKind: input.sourceKind,
    limit: limit - fresh.length,
  })
  const counts: SweepCounts = { scanned: 0, accepted: 0, blocked: 0, skipped: 0 }
  for (const sourceId of [...new Set([...fresh, ...due])]) {
    if (input.timeBudgetMs != null && Date.now() - started >= input.timeBudgetMs) break
    counts.scanned++
    try {
      const { status } = await input.handle(sourceId)
      counts[status] = (counts[status] ?? 0) + 1
    } catch (error) {
      counts.blocked++
      // Rescheduled, so a source that throws is not re-offered every pass.
      await upsertWorkItem(db, input.organizationId, {
        sourceKind: input.sourceKind,
        sourceId,
        stage: input.stage,
        ...refusalFromError(error),
      })
    }
  }
  return counts
}

/**
 * The orgs the recovery job visits: those with due work first, then every other org
 * whose accounting is finalized (a never-tried source holds no row to be due).
 */
export async function listOrganizationsForSweep(
  db: Database,
  input: { limit: number; now?: Date }
): Promise<string[]> {
  const t = schema.AccountingWorkItem
  const due = db
    .select({ organizationId: t.organizationId, dueAt: min(t.nextAttemptAt).as('dueAt') })
    .from(t)
    .where(lte(t.nextAttemptAt, input.now ?? new Date()))
    .groupBy(t.organizationId)
    .as('due')
  const rows = await db
    .select({ id: schema.OrganizationSetting.organizationId })
    .from(schema.OrganizationSetting)
    .leftJoin(due, eq(due.organizationId, schema.OrganizationSetting.organizationId))
    .where(
      and(
        eq(schema.OrganizationSetting.key, 'accounting.setupState'),
        sql`${schema.OrganizationSetting.value} = to_jsonb('finalized'::text)`
      )
    )
    // Random among orgs with nothing due, so none is always last.
    .orderBy(sql`${due.dueAt} ASC NULLS LAST`, sql`random()`)
    .limit(input.limit)
  return rows.map((row) => row.id)
}
