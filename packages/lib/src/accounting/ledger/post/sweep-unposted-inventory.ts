// packages/lib/src/accounting/ledger/post/sweep-unposted-inventory.ts
//
// The inventory catch-up (111 Q22b): a valued movement dated after the cutover
// with no `member` link on a posted entry was written while accounting was off
// (or its post threw), and nothing else will ever post it. Same predicate as the
// close's `inventory_unposted` blocker (`periods/read-close-blockers.ts`).

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, asc, eq, gt, isNotNull, ne, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { getOrgCache } from '../../../cache'
import { StockMovementCostBasis, StockMovementType } from '../../../resources/registry/enum-values'
import { systemDefId, systemFieldMap } from '../../../resources/system-records'
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
        movementIds: document.map((row) => row.movementId),
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  if (counts.scanned > 0)
    logger.info('Swept unposted inventory movements', { organizationId, ...counts })
  return counts
}

/**
 * Valued (`cost_basis <> pending`, non-zero cost) movements dated after the cutover, in no posted
 * `inventory_movement` entry, oldest first. A `return_out` is excluded: its entry is the vendor
 * credit's, and one that never posted is that document's problem, not a movement's.
 */
async function listUnpostedMovementIds(
  db: Database,
  organizationId: string,
  limit: number
): Promise<string[]> {
  const defId = await systemDefId(db, organizationId, 'stock_movement')
  const fields = await systemFieldMap(db, organizationId, [
    'stock_movement_occurred_at',
    'stock_movement_extended_cost',
    'stock_movement_cost_basis',
    'stock_movement_type',
  ] as const)
  const occurredAt = fields.stock_movement_occurred_at
  const extendedCost = fields.stock_movement_extended_cost
  const costBasis = fields.stock_movement_cost_basis
  const type = fields.stock_movement_type
  if (!defId || !occurredAt || !extendedCost || !costBasis || !type) return []

  const K = OPENING_BASELINE_SETTING_KEYS
  const settings = await readOrganizationSettings(organizationId, [K.cutoffPeriod] as const)
  const cutoff = settings[K.cutoffPeriod]?.trim()
  const cutoverDate = cutoff ? cutoverDateFor(cutoff) : null

  const optionRows = (fieldId: string, optionId: string) =>
    db
      .select({ entityId: schema.FieldValue.entityId })
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.organizationId, organizationId),
          eq(schema.FieldValue.fieldId, fieldId),
          eq(schema.FieldValue.optionId, optionId)
        )
      )
  const pending = optionRows(costBasis.id, StockMovementCostBasis.PENDING)
  const returnOut = optionRows(type.id, StockMovementType.RETURN_OUT)
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

  const cost = alias(schema.FieldValue, 'movement_cost')
  const rows = await db
    .select({ id: schema.EntityInstance.id })
    .from(schema.FieldValue)
    .innerJoin(
      schema.EntityInstance,
      and(
        eq(schema.EntityInstance.id, schema.FieldValue.entityId),
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, defId),
        sql`${schema.EntityInstance.archivedAt} IS NULL`
      )
    )
    .innerJoin(
      cost,
      and(
        eq(cost.organizationId, organizationId),
        eq(cost.entityId, schema.FieldValue.entityId),
        eq(cost.fieldId, extendedCost.id),
        isNotNull(cost.valueNumber),
        ne(cost.valueNumber, 0)
      )
    )
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, occurredAt.id),
        isNotNull(schema.FieldValue.valueDate),
        ...(cutoverDate ? [gt(sql`${schema.FieldValue.valueDate}::date`, cutoverDate)] : []),
        sql`${schema.FieldValue.entityId} NOT IN ${pending}`,
        sql`${schema.FieldValue.entityId} NOT IN ${returnOut}`,
        sql`${schema.FieldValue.entityId} NOT IN ${posted}`
      )
    )
    .orderBy(asc(schema.FieldValue.valueDate), asc(schema.EntityInstance.createdAt))
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
