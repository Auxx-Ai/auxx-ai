// packages/lib/src/accounting/ledger/post/sweep-unposted-inventory.ts
//
// The inventory catch-up (111 Q22b): a valued movement dated after the cutover
// with no `member` link on a posted entry was written while accounting was off
// (or its post threw), and nothing else will ever post it. Same predicate as the
// close's `inventory_unposted` blocker (`periods/read-close-blockers.ts`).

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, eq, gt, isNotNull, isNull, ne, notInArray, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { getOrgCache } from '../../../cache'
import { StockMovementCostBasis, StockMovementType } from '../../../resources/registry/enum-values'
import { readOrganizationSettings } from '../../../settings/read'
import { cutoverDateFor } from '../builders/opening-balance'
import { OPENING_BASELINE_SETTING_KEYS } from '../setup/setup-readiness'
import {
  type InventoryDocumentRow,
  postInventoryDocument,
  readFulfillmentLineParents,
  readInventoryDocumentRows,
} from './post-inventory-document'

const logger = createScopedLogger('postings:sweep-unposted-inventory')

export interface UnpostedInventorySweepCounts {
  scanned: number
  posted: number
  /** Documents the ledger declined (returned a non-posted status) or that threw; re-offered next run. */
  failed: number
}

/**
 * Post the oldest unposted valued movements, as their original documents, `limit` rows per run.
 * Only finalized orgs are visited (`listOrganizationsForSweep`), so the poster's own gates - the
 * cutover floor, accounting off - are belts here, not the rule.
 */
export async function sweepUnpostedInventory(
  db: Database,
  input: { organizationId: string; limit?: number; timeBudgetMs?: number }
): Promise<UnpostedInventorySweepCounts> {
  const { organizationId } = input
  const started = Date.now()
  const counts: UnpostedInventorySweepCounts = { scanned: 0, posted: 0, failed: 0 }

  const ids = await listUnpostedMovementIds(db, organizationId, input.limit ?? 100)
  if (ids.length === 0) return counts
  const rows = (await readInventoryDocumentRows(db, organizationId, ids))
    .filter((row) => !row.pending && row.extendedCost != null && row.extendedCost !== 0)
    .map((row) => ({ ...row, extendedCost: row.extendedCost as number }))
  const documents = await groupByDocument(db, organizationId, rows)
  const actorUserId = await getOrgCache().get(organizationId, 'systemUser')

  for (const document of documents) {
    if (input.timeBudgetMs != null && Date.now() - started >= input.timeBudgetMs) break
    counts.scanned += document.length
    try {
      const post = await postInventoryDocument(db, organizationId, document, { actorUserId })
      if (post?.status === 'posted' || post?.status === 'already_posted') counts.posted++
      else counts.failed++
    } catch (error) {
      counts.failed++
      logger.warn('An unposted inventory document could not be posted', {
        organizationId,
        movementIds: document.map((row) => row.id),
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  if (counts.scanned > 0)
    logger.info('Swept unposted inventory movements', { organizationId, ...counts })
  return counts
}

/**
 * Valued (`costBasis <> pending`, non-zero cost) movements dated after the cutover, in no posted
 * `inventory_movement` entry, oldest first. A `return_out` is excluded: its entry is the vendor
 * credit's, and one that never posted is that document's problem, not a movement's.
 */
async function listUnpostedMovementIds(
  db: Database,
  organizationId: string,
  limit: number
): Promise<string[]> {
  const K = OPENING_BASELINE_SETTING_KEYS
  const settings = await readOrganizationSettings(organizationId, [K.cutoffPeriod] as const)
  const cutoff = settings[K.cutoffPeriod]?.trim()
  const cutoverDate = cutoff ? cutoverDateFor(cutoff) : null

  const posted = db
    .select({ sourceId: schema.GlPostingSource.sourceId })
    .from(schema.GlPostingSource)
    .innerJoin(schema.GlPosting, eq(schema.GlPosting.id, schema.GlPostingSource.glPostingId))
    .where(
      and(
        eq(schema.GlPostingSource.organizationId, organizationId),
        eq(schema.GlPostingSource.sourceKind, 'stock_movement'),
        eq(schema.GlPostingSource.linkRole, 'member'),
        eq(schema.GlPosting.status, 'posted')
      )
    )

  // A build posts as one document once every leg is valued (`price-build.ts` posts it then); its
  // valued legs left in here would be refused on every run and hold the oldest-first page forever.
  const pendingLeg = alias(schema.StockMovement, 'pending_leg')
  const buildsWaitingOnACost = db
    .selectDistinct({ buildId: pendingLeg.buildId })
    .from(pendingLeg)
    .where(
      and(
        eq(pendingLeg.organizationId, organizationId),
        isNotNull(pendingLeg.buildId),
        eq(pendingLeg.costBasis, StockMovementCostBasis.PENDING)
      )
    )

  const t = schema.StockMovement
  const rows = await db
    .select({ id: t.id })
    .from(t)
    .where(
      and(
        eq(t.organizationId, organizationId),
        isNotNull(t.occurredAt),
        ...(cutoverDate ? [gt(sql`${t.occurredAt}::date`, cutoverDate)] : []),
        isNotNull(t.extendedCostMinor),
        ne(t.extendedCostMinor, 0),
        sql`${t.costBasis} IS DISTINCT FROM ${StockMovementCostBasis.PENDING}`,
        ne(t.type, StockMovementType.RETURN_OUT),
        or(isNull(t.buildId), notInArray(t.buildId, buildsWaitingOnACost)),
        sql`${t.id} NOT IN ${posted}`
      )
    )
    .orderBy(asc(t.occurredAt), asc(t.createdAt))
    .limit(Math.max(1, limit))
  return rows.map((row) => row.id)
}

/** One document per build, per dispatch (the rows in this page are its pass), and per lone row. */
async function groupByDocument(
  db: Database,
  organizationId: string,
  rows: readonly InventoryDocumentRow[]
): Promise<InventoryDocumentRow[][]> {
  const documents: InventoryDocumentRow[][] = []
  const byBuild = new Map<string, InventoryDocumentRow[]>()
  const byFulfillment = new Map<string, InventoryDocumentRow[]>()
  const parents = await readFulfillmentLineParents(
    db,
    organizationId,
    rows.flatMap((row) => (row.fulfillmentLineId ? [row.fulfillmentLineId] : []))
  )
  const push = (map: Map<string, InventoryDocumentRow[]>, key: string, row: InventoryDocumentRow) =>
    map.set(key, [...(map.get(key) ?? []), row])
  for (const row of rows) {
    if (row.buildId) push(byBuild, row.buildId, row)
    else if (row.fulfillmentLineId && parents.get(row.fulfillmentLineId))
      push(byFulfillment, parents.get(row.fulfillmentLineId)!.fulfillmentId, row)
    else documents.push([row])
  }
  return [...documents, ...byBuild.values(), ...byFulfillment.values()]
}
