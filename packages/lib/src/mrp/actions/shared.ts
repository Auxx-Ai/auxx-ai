// packages/lib/src/mrp/actions/shared.ts

import { type Database, schema } from '@auxx/database'
import { toDateKey } from '@auxx/utils/calendar-day'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { NotFoundError } from '../../errors'
import type { MrpSuggestionKind } from '../client'

/** The run an action drafts from. */
export interface ActionRun {
  id: string
  asOf: Date
}

/** The suggestion columns an action reads off one `MrpPlanRunItem`. */
export interface ActionItem {
  partId: string
  suggestionKind: MrpSuggestionKind | null
  suggestedQty: number | null
  suggestedVendorPartId: string | null
  suggestedSupplierId: string | null
}

/** A selected part that produced no document, and why. */
export interface ActionRefusal {
  partId: string
  reason: string
}

/**
 * The given completed run, or the org's latest completed one. `mrp/reads/runs.ts` has the full
 * version; this is the minimum an action needs.
 */
export async function resolveActionRun(
  db: Database,
  organizationId: string,
  runId?: string
): Promise<ActionRun> {
  const [run] = await db
    .select({ id: schema.MrpPlanRun.id, asOf: schema.MrpPlanRun.asOf })
    .from(schema.MrpPlanRun)
    .where(
      and(
        eq(schema.MrpPlanRun.organizationId, organizationId),
        eq(schema.MrpPlanRun.status, 'completed'),
        runId ? eq(schema.MrpPlanRun.id, runId) : undefined
      )
    )
    .orderBy(desc(schema.MrpPlanRun.asOf), desc(schema.MrpPlanRun.finishedAt))
    .limit(1)
  if (!run) {
    throw new NotFoundError(
      runId ? 'That MRP run was not found or has not completed' : 'No completed MRP run yet'
    )
  }
  return run
}

/** The run's items for these parts, keyed by part id; a part the run did not plan is absent. */
export async function readActionItems(
  db: Database,
  organizationId: string,
  runId: string,
  partIds: readonly string[]
): Promise<Map<string, ActionItem>> {
  if (partIds.length === 0) return new Map()
  const rows = await db
    .select({
      partId: schema.MrpPlanRunItem.partId,
      suggestionKind: schema.MrpPlanRunItem.suggestionKind,
      suggestedQty: schema.MrpPlanRunItem.suggestedQty,
      suggestedVendorPartId: schema.MrpPlanRunItem.suggestedVendorPartId,
      suggestedSupplierId: schema.MrpPlanRunItem.suggestedSupplierId,
    })
    .from(schema.MrpPlanRunItem)
    .where(
      and(
        eq(schema.MrpPlanRunItem.organizationId, organizationId),
        eq(schema.MrpPlanRunItem.mrpPlanRunId, runId),
        inArray(schema.MrpPlanRunItem.partId, [...partIds])
      )
    )
  return new Map(rows.map((row) => [row.partId, row]))
}

/** First occurrence wins, so a part selected twice drafts once. */
export function uniqueByPart<T extends { partId: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.partId)) return false
    seen.add(item.partId)
    return true
  })
}

/** The memo every drafted document carries: the run it came from and the parts it covers. */
export function runNote(run: ActionRun, partIds: readonly string[]): string {
  return `Drafted from MRP run ${run.id} (as of ${toDateKey(run.asOf)}). Parts: ${partIds.join(', ')}`
}

/** A usable quantity, or null when it is missing, not finite, or not positive. */
export function positiveQuantity(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}
