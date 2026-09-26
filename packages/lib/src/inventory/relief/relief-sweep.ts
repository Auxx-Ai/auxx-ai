// packages/lib/src/inventory/relief/relief-sweep.ts

import { type Database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { readFulfillmentPostingSubject } from '../../accounting/sales/fulfillments'
import type { WorkItemSourceKind } from '../../accounting/work-items/codes'
import { runWorkItemSweep, type SweepCounts } from '../../accounting/work-items/sweep'
import { deleteWorkItemsAtStage, upsertWorkItem } from '../../accounting/work-items/write'
import { getOrgCache } from '../../cache'
import {
  pricePendingMovements,
  readBuildPendingParts,
  readMovementPartIds,
  readStillPending,
} from '../costing/price-pending-movements'
import { readReliefLines } from './backfill'
import { relieveFulfillmentLines } from './relieve'

/** The three document kinds that park at stage `price` (111 Q21). */
const PRICE_SOURCE_KINDS = [
  'fulfillment',
  'build',
  'stock_movement',
] as const satisfies readonly WorkItemSourceKind[]

/**
 * The backstop under the inline pricer (111 Q22): re-offer every document parked at stage `price`
 * to the pricer. Nothing is fresh here - the four standard doors price inline; this lane exists
 * for an org that was in draft, a pricer that threw, or a part priced by a route with no door.
 */
export async function sweepPendingPricing(
  db: Database,
  input: { organizationId: string; limit?: number; timeBudgetMs?: number }
): Promise<SweepCounts> {
  const { organizationId } = input
  const started = Date.now()
  const total: SweepCounts = { scanned: 0, accepted: 0, blocked: 0, skipped: 0 }
  for (const sourceKind of PRICE_SOURCE_KINDS) {
    const timeBudgetMs =
      input.timeBudgetMs == null
        ? undefined
        : Math.max(1, input.timeBudgetMs - (Date.now() - started))
    const counts = await runWorkItemSweep(db, {
      organizationId,
      stage: 'price',
      sourceKind,
      limit: input.limit ?? 100,
      timeBudgetMs,
      listFresh: async () => [],
      handle: (sourceId) => priceOne(db, organizationId, sourceKind, sourceId),
    })
    for (const [key, value] of Object.entries(counts)) total[key] = (total[key] ?? 0) + value
  }
  return total
}

/**
 * Price one parked document. `accepted` when nothing of it is pending any more, whoever priced
 * it, `blocked` while a part still has no standard, `skipped` when the source is
 * gone. A blocked row is re-recorded so it backs off rather than being re-offered every pass.
 */
export async function priceOne(
  db: Database,
  organizationId: string,
  sourceKind: (typeof PRICE_SOURCE_KINDS)[number],
  sourceId: string
): Promise<{ status: string }> {
  const item = await readItem(db, organizationId, sourceKind, sourceId)
  const detailIds = pendingMovementIdsOf(item?.detail ?? null)

  // A dispatch re-staged from `relieve` (migration 193) names no rows: relief itself writes them
  // now, priced where the standard exists and pending where it does not.
  if (sourceKind === 'fulfillment' && detailIds.length === 0) {
    return relieveOne(db, organizationId, sourceId)
  }

  const target =
    sourceKind === 'build'
      ? await readBuildPendingParts(db, organizationId, sourceId)
      : await readMovementPartIds(
          db,
          organizationId,
          sourceKind === 'stock_movement' ? [sourceId] : detailIds
        )
  if (target.pendingMovementIds.length === 0) {
    await deleteWorkItemsAtStage(db, organizationId, {
      sourceKind,
      sourceIds: [sourceId],
      stage: 'price',
    })
    return { status: 'accepted' }
  }

  const priced = await pricePendingMovements(db, organizationId, target.partIds)
  if (priced.isErr()) throw priced.error
  // Decide by what is still pending, not by what this pass priced: a concurrent pass may have priced them.
  const remaining = await readStillPending(db, organizationId, target.pendingMovementIds)
  if (remaining.size === 0) {
    await deleteWorkItemsAtStage(db, organizationId, {
      sourceKind,
      sourceIds: [sourceId],
      stage: 'price',
    })
    return { status: 'accepted' }
  }
  if (item) {
    await upsertWorkItem(db, organizationId, {
      sourceKind,
      sourceId,
      stage: 'price',
      reasonCode: 'STANDARD_COST_MISSING',
      externalRef: item.externalRef,
      detail: item.detail,
    })
  }
  return { status: 'blocked' }
}

async function relieveOne(
  db: Database,
  organizationId: string,
  fulfillmentId: string
): Promise<{ status: string }> {
  const subject = await readFulfillmentPostingSubject(db, { organizationId, fulfillmentId })
  const lines = subject
    ? (await readReliefLines(db, organizationId, [subject.orderId], fulfillmentId)).lines
    : []
  // Gone, orderless or cancelled: nothing left to relieve, so nothing left to park.
  if (lines.length === 0) {
    await deleteWorkItemsAtStage(db, organizationId, {
      sourceKind: 'fulfillment',
      sourceIds: [fulfillmentId],
      stage: 'price',
    })
    return { status: 'skipped' }
  }
  const userId = await getOrgCache().get(organizationId, 'systemUser')
  const result = await relieveFulfillmentLines(db, { organizationId, userId, lines })
  if (result.isErr()) throw result.error
  return { status: result.value.skippedNoCost > 0 ? 'blocked' : 'accepted' }
}

async function readItem(
  db: Database,
  organizationId: string,
  sourceKind: string,
  sourceId: string
): Promise<{ externalRef: string | null; detail: Record<string, unknown> } | null> {
  const t = schema.AccountingWorkItem
  const [row] = await db
    .select({ externalRef: t.externalRef, detail: t.detail })
    .from(t)
    .where(
      and(
        eq(t.organizationId, organizationId),
        eq(t.sourceKind, sourceKind),
        eq(t.sourceId, sourceId),
        eq(t.stage, 'price')
      )
    )
    .limit(1)
  return row ?? null
}

function pendingMovementIdsOf(detail: Record<string, unknown> | null): string[] {
  const ids = detail?.pendingMovementIds
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
}
