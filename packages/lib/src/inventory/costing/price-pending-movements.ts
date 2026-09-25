// packages/lib/src/inventory/costing/price-pending-movements.ts
//
// The pricer (111 Q18, Q22): a part's first standard values its `pending`
// movements and posts the documents they belong to. Called inline from every
// door that writes a standard; the recovery job's `price` lane is the backstop.

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import {
  type InventoryDocumentRow,
  loadInventoryDocumentContext,
  postInventoryDocument,
  readFulfillmentLineParents,
  readInventoryDocumentRows,
  type StoredInventoryDocumentRow,
  valuedDocumentRow,
} from '../../accounting/ledger/post/post-inventory-document'
import { deleteWorkItemsAtStage } from '../../accounting/work-items/write'
import { getOrgCache } from '../../cache'
import { StockMovementCostBasis } from '../../resources/registry/enum-values'
import { findSystemRecordIdsByValue } from '../../resources/system-records'
import { finishPricedBuild } from '../builds/price-build'
import { fillPendingCost } from '../movements/fill-pending-cost'
import { guard } from './guard'
import { readStandardCost } from './standard-cost-queries'

const logger = createScopedLogger('costing:price-pending')

export interface PricingSummary {
  /** Every row this pass valued. */
  pricedMovementIds: string[]
  /** Named parts still without a standard; their rows stay pending. */
  unpricedPartIds: string[]
  /** Documents handed to the ledger, whatever it answered. */
  documentsPosted: number
  /** Documents whose post threw; their rows are valued and the catch-up sweep posts them. */
  documentsFailed: number
  /** Builds whose last leg this pass priced. */
  finishedBuildIds: string[]
}

const EMPTY: PricingSummary = {
  pricedMovementIds: [],
  unpricedPartIds: [],
  documentsPosted: 0,
  documentsFailed: 0,
  finishedBuildIds: [],
}

/**
 * Value every `pending` movement of these parts at their standard and post each document once
 * every row of it is valued: one `sale` entry per dispatch per pass, one `build` entry when the
 * last leg is priced, one entry per lone `adjust` / `initial`. A part with no usable standard is
 * skipped (a stored $0 with an origin is one). Idempotent: a second call finds nothing pending.
 * Never throws for a document the ledger declines - the rows are valued either way.
 */
export async function pricePendingMovements(
  db: Database,
  organizationId: string,
  partIds: readonly string[]
): Promise<Result<PricingSummary, Error>> {
  return guard(
    async () => {
      const requested = [...new Set(partIds.filter(Boolean))]
      if (requested.length === 0) return EMPTY

      const standards = await readStandardCost(db, organizationId, requested)
      if (standards.isErr()) throw standards.error
      const priced = requested.filter((partId) => standards.value.has(partId))
      const unpricedPartIds = requested.filter((partId) => !standards.value.has(partId))
      if (priced.length === 0) return { ...EMPTY, unpricedPartIds }

      const pending = await readPendingRows(db, organizationId, priced)
      if (pending.length === 0) return { ...EMPTY, unpricedPartIds }

      const filled = await fillPendingCost(
        db,
        organizationId,
        pending.map((row) => ({
          movementId: row.movementId,
          unitCost: standards.value.get(row.partInstanceId!)!.standardCost,
        }))
      )
      if (filled.isErr()) throw filled.error
      const costByMovement = new Map(filled.value.map((row) => [row.movementId, row.extendedCost]))
      const rows: InventoryDocumentRow[] = pending.map((row) =>
        valuedDocumentRow({
          ...row,
          pending: false,
          costBasis: StockMovementCostBasis.STANDARD,
          extendedCost: costByMovement.get(row.movementId) ?? null,
        })
      )
      const pricedMovementIds = rows.map((row) => row.movementId)

      const userId = await getOrgCache().get(organizationId, 'systemUser')
      const posted = await postDocuments(db, organizationId, rows, userId)
      await resolveWorkItems(db, organizationId, {
        pricedMovementIds,
        finishedBuildIds: posted.finishedBuildIds,
      })

      logger.info('Priced pending stock movements', {
        organizationId,
        parts: priced.length,
        unpricedParts: unpricedPartIds.length,
        movements: pricedMovementIds.length,
        documentsPosted: posted.documentsPosted,
        documentsFailed: posted.documentsFailed,
        finishedBuilds: posted.finishedBuildIds.length,
      })
      return { pricedMovementIds, unpricedPartIds, ...posted }
    },
    'Failed to price pending stock movements',
    { organizationId, partIds: partIds.length }
  )
}

/** {@link pricePendingMovements} for a door that wrote a standard: a pricing failure is logged, never the caller's error. */
export async function pricePendingMovementsQuietly(
  db: Database,
  organizationId: string,
  partIds: readonly string[]
): Promise<void> {
  if (partIds.length === 0) return
  const priced = await pricePendingMovements(db, organizationId, partIds)
  if (priced.isErr()) {
    logger.error('Pricing after a standard-cost write failed; the recovery lane retries it', {
      organizationId,
      partIds: partIds.length,
      error: priced.error.message,
    })
  }
}

/** Every `pending` movement of these parts, in ledger order. */
async function readPendingRows(
  db: Database,
  organizationId: string,
  partIds: readonly string[]
): Promise<StoredInventoryDocumentRow[]> {
  const ctx = await loadInventoryDocumentContext(db, organizationId)
  if (!ctx) return []
  const found = await findSystemRecordIdsByValue(db, organizationId, ctx, [
    { attribute: 'stock_movement_cost_basis', option: [StockMovementCostBasis.PENDING] },
    { attribute: 'stock_movement_part', related: partIds },
  ])
  const ids = [...new Set([...found.values()].flat())]
  const rows = await readInventoryDocumentRows(db, organizationId, ids)
  return rows.filter((row) => row.pending && row.partInstanceId)
}

/**
 * Group the valued rows by document and post each in its own transaction. A relief pass is one
 * document per dispatch; a build posts through `finishPricedBuild` once no leg is pending; every
 * other row is its own document.
 */
async function postDocuments(
  db: Database,
  organizationId: string,
  rows: readonly InventoryDocumentRow[],
  actorUserId: string
): Promise<Pick<PricingSummary, 'documentsPosted' | 'documentsFailed' | 'finishedBuildIds'>> {
  const documents: InventoryDocumentRow[][] = []
  const byFulfillment = new Map<string, InventoryDocumentRow[]>()
  const buildIds = new Set<string>()

  const lineIds = rows.flatMap((row) => (row.fulfillmentLineId ? [row.fulfillmentLineId] : []))
  const parents = await readFulfillmentLineParents(db, organizationId, lineIds)
  for (const row of rows) {
    if (row.buildId) {
      buildIds.add(row.buildId)
      continue
    }
    const fulfillmentId = row.fulfillmentLineId
      ? parents.get(row.fulfillmentLineId)?.fulfillmentId
      : undefined
    if (fulfillmentId) {
      const group = byFulfillment.get(fulfillmentId) ?? []
      group.push(row)
      byFulfillment.set(fulfillmentId, group)
      continue
    }
    documents.push([row])
  }
  documents.push(...byFulfillment.values())

  let documentsPosted = 0
  let documentsFailed = 0
  for (const document of documents) {
    try {
      await postInventoryDocument(db, organizationId, document, { actorUserId })
      documentsPosted++
    } catch (error) {
      documentsFailed++
      logger.error('A priced document could not be posted; the catch-up sweep retries it', {
        organizationId,
        movementIds: document.map((row) => row.movementId),
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const finishedBuildIds: string[] = []
  for (const buildId of buildIds) {
    try {
      const finished = await finishPricedBuild(db, organizationId, buildId)
      if (!finished.finished) continue
      finishedBuildIds.push(buildId)
      documentsPosted++
    } catch (error) {
      documentsFailed++
      logger.error('A priced build could not be finished; the catch-up sweep retries its entry', {
        organizationId,
        buildId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return { documentsPosted, documentsFailed, finishedBuildIds }
}

/**
 * Clear the `price` work items this pass discharged: a movement's own row, a finished build's
 * row, and a dispatch's row once none of its `pendingMovementIds` is pending any more. A dispatch
 * row with no ids (re-staged from `relieve`, migration 193) is the sweep handler's to re-derive.
 */
async function resolveWorkItems(
  db: Database,
  organizationId: string,
  input: { pricedMovementIds: readonly string[]; finishedBuildIds: readonly string[] }
): Promise<void> {
  await deleteWorkItemsAtStage(db, organizationId, {
    sourceKind: 'stock_movement',
    sourceIds: input.pricedMovementIds,
    stage: 'price',
  })
  await deleteWorkItemsAtStage(db, organizationId, {
    sourceKind: 'build',
    sourceIds: input.finishedBuildIds,
    stage: 'price',
  })

  const t = schema.AccountingWorkItem
  const items = await db
    .select({ sourceId: t.sourceId, detail: t.detail })
    .from(t)
    .where(
      and(
        eq(t.organizationId, organizationId),
        eq(t.sourceKind, 'fulfillment'),
        eq(t.stage, 'price')
      )
    )
  const priced = new Set(input.pricedMovementIds)
  const candidates = items.flatMap((item) => {
    const ids = pendingMovementIdsOf(item.detail)
    return ids.length > 0 && ids.some((id) => priced.has(id))
      ? [{ sourceId: item.sourceId, ids }]
      : []
  })
  if (candidates.length === 0) return
  const stillPending = await readStillPending(
    db,
    organizationId,
    candidates.flatMap((item) => item.ids.filter((id) => !priced.has(id)))
  )
  await deleteWorkItemsAtStage(db, organizationId, {
    sourceKind: 'fulfillment',
    sourceIds: candidates
      .filter((item) => !item.ids.some((id) => stillPending.has(id)))
      .map((item) => item.sourceId),
    stage: 'price',
  })
}

function pendingMovementIdsOf(detail: Record<string, unknown> | null): string[] {
  const ids = detail?.pendingMovementIds
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
}

async function readStillPending(
  db: Database,
  organizationId: string,
  movementIds: readonly string[]
): Promise<Set<string>> {
  const ids = [...new Set(movementIds)]
  if (ids.length === 0) return new Set()
  const rows = await readInventoryDocumentRows(db, organizationId, ids)
  return new Set(rows.filter((row) => row.pending).map((row) => row.movementId))
}

/** The parts behind these movements, for a handler that holds only movement ids. */
export async function readMovementPartIds(
  db: Database,
  organizationId: string,
  movementIds: readonly string[]
): Promise<{ partIds: string[]; pendingMovementIds: string[] }> {
  const rows = await readInventoryDocumentRows(db, organizationId, [...new Set(movementIds)])
  const pending = rows.filter((row) => row.pending)
  return {
    partIds: [
      ...new Set(pending.flatMap((row) => (row.partInstanceId ? [row.partInstanceId] : []))),
    ],
    pendingMovementIds: pending.map((row) => row.movementId),
  }
}

/** The parts behind a build's pending legs. */
export async function readBuildPendingParts(
  db: Database,
  organizationId: string,
  buildId: string
): Promise<{ partIds: string[]; pendingMovementIds: string[] }> {
  const ctx = await loadInventoryDocumentContext(db, organizationId)
  if (!ctx) return { partIds: [], pendingMovementIds: [] }
  const found = await findSystemRecordIdsByValue(db, organizationId, ctx, [
    { attribute: 'stock_movement_cost_basis', option: [StockMovementCostBasis.PENDING] },
    { attribute: 'stock_movement_build', related: [buildId] },
  ])
  return readMovementPartIds(db, organizationId, [...found.values()].flat())
}
