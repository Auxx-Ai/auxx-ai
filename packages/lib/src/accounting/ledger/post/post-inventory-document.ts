// packages/lib/src/accounting/ledger/post/post-inventory-document.ts
//
// Post one inventory document from its already-valued `StockMovement` rows.
//
// The writers post inside their own transaction with everything in hand; two
// callers do not: the pricer (a row valued after its document was written,
// 111 Q18) and the catch-up sweep (a row written while accounting was off,
// 111 Q22b). Both hold rows and nothing else, so this file derives what
// `postInventoryMovementInTx` needs from the rows' links - kind, subject,
// parents, the COGS split, a build's absorption - and is the one definition of
// how a row posts when its writer is no longer on the stack.

import type { Database, Transaction } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { UnprocessableEntityError } from '../../../errors'
import { getBuild, readBuildMovements } from '../../../inventory/builds/build-queries'
import { readStandardCost } from '../../../inventory/costing/standard-cost-queries'
import { computeExtendedCost } from '../../../inventory/movements/client'
import { readMovementsByIds, type StockMovementRow } from '../../../inventory/movements/reads'
import { sumReliefCogsSplit } from '../../../inventory/relief/cogs-split'
import { StockMovementCostBasis, StockMovementType } from '../../../resources/registry/enum-values'
import { readSystemRecords } from '../../../resources/system-records'
import { loadFulfillmentFieldContext } from '../../sales/fulfillments/fields'
import type {
  InventoryDocumentKind,
  InventoryMovementLine,
  ReliefCogsSplit,
} from '../builders/inventory-movement'
import type { PostResult } from '../types'
import type { InTxPostResult } from './post-entry'
import {
  exportInventoryMovement,
  type PostInventoryMovementInput,
  postInventoryMovementInTx,
} from './post-inventory-movement'

const logger = createScopedLogger('postings:inventory-document')

/** One valued movement, as the document poster reads it. A pending row must never reach here. */
export interface InventoryDocumentRow {
  id: string
  partInstanceId: string | null
  /** A `StockMovementType` value. */
  type: string | null
  quantity: number
  /** SIGNED, integer minor units. */
  extendedCost: number
  /** The frozen inventory ROLE. */
  glRole: string | null
  occurredAt: Date
  fulfillmentLineId?: string | null
  buildId?: string | null
  /** Receipts only: what the row accrued, so a late post splits `grni` / freight / duties as the receipt did. */
  vendorUnitPrice?: number | null
  freightAccrued?: number | null
  dutiesAccrued?: number | null
}

export interface PostInventoryDocumentOptions {
  actorUserId?: string
  memo?: string
}

/** The parent links a relief entry carries: the dispatch and the order it shipped against. */
export function saleDocumentParents(
  fulfillmentId: string,
  orderId: string
): { sourceKind: string; sourceId: string }[] {
  return [
    { sourceKind: 'fulfillment', sourceId: fulfillmentId },
    { sourceKind: 'order', sourceId: orderId },
  ]
}

/** The subject, parents and absorption a build's entry carries, from the build row as stamped. */
export function buildDocumentPosting(build: {
  buildId: string
  orderId: string | null
  laborCost: number | null
  overheadCost: number | null
}): Pick<PostInventoryMovementInput, 'kind' | 'subject' | 'parents' | 'absorbed'> {
  return {
    kind: 'build',
    subject: { sourceKind: 'build', sourceId: build.buildId },
    ...(build.orderId ? { parents: [{ sourceKind: 'order', sourceId: build.orderId }] } : {}),
    absorbed: { laborMinor: build.laborCost ?? 0, overheadMinor: build.overheadCost ?? 0 },
  }
}

const KIND_BY_TYPE: Record<string, InventoryDocumentKind> = {
  [StockMovementType.SALE]: 'sale',
  [StockMovementType.SHIP]: 'sale',
  [StockMovementType.ADJUST]: 'adjust',
  [StockMovementType.INITIAL]: 'opening',
  [StockMovementType.SCRAP]: 'scrap',
  [StockMovementType.RETURN_IN]: 'return',
  [StockMovementType.RECEIVE]: 'receive',
  [StockMovementType.REVALUE]: 'revalue',
  [StockMovementType.BUILD_CONSUME]: 'build',
  [StockMovementType.BUILD_PRODUCE]: 'build',
}

/**
 * What the rows are, to the ledger. A build link or a fulfillment-line link decides ahead of the
 * type; a `return_out` is refused, because its `grni` figure is the vendor credit's, not the row's.
 */
export function inventoryDocumentKind(
  rows: readonly InventoryDocumentRow[]
): InventoryDocumentKind {
  if (rows.some((row) => row.buildId)) return 'build'
  if (rows.some((row) => row.fulfillmentLineId)) return 'sale'
  const type = rows[0]?.type ?? null
  if (type === StockMovementType.RETURN_OUT) {
    throw new UnprocessableEntityError(
      'A return to the vendor is posted by its vendor credit, not from its movements'
    )
  }
  const kind = type ? KIND_BY_TYPE[type] : undefined
  if (!kind) {
    throw new UnprocessableEntityError(
      `Stock movements of type ${type ?? '(none)'} have no entry`,
      {
        type: type ?? undefined,
      }
    )
  }
  return kind
}

function toLine(row: InventoryDocumentRow): InventoryMovementLine {
  if (!row.glRole) {
    throw new UnprocessableEntityError(
      `Stock movement ${row.id} carries no frozen inventory account and cannot be posted`,
      { movementId: row.id }
    )
  }
  const line: InventoryMovementLine = {
    id: row.id,
    extendedCostMinor: row.extendedCost,
    glAccountRole: row.glRole,
  }
  // A receipt against a supplier row accrued `grni` at the agreed price and the adders beside it.
  if (row.type === StockMovementType.RECEIVE && row.vendorUnitPrice != null) {
    line.accrual = {
      grniMinor: computeExtendedCost(row.vendorUnitPrice, row.quantity),
      freightMinor: row.freightAccrued ?? 0,
      dutiesMinor: row.dutiesAccrued ?? 0,
    }
  }
  return line
}

/**
 * Post the entry of ONE document on the caller's transaction, from its valued rows.
 *
 * The subject follows 73-D11 / the inventory guide §9.3: a build claims its build id, once, so a
 * build with any leg still pending is refused; every other document claims the FIRST row it is
 * handed - for a relief that is the first movement of this pass, so a dispatch valued over several
 * passes posts several entries under the same fulfillment and order parents. `occurredAt` is the
 * first row's. Same answers as `postInventoryMovementInTx`: `null` when there is nothing to post.
 */
export async function postInventoryDocumentInTx(
  tx: Transaction,
  organizationId: string,
  rows: readonly InventoryDocumentRow[],
  options: PostInventoryDocumentOptions = {}
): Promise<InTxPostResult | null> {
  if (rows.length === 0) return null
  const db = tx as unknown as Database
  const kind = inventoryDocumentKind(rows)
  const first = rows[0]!
  const base = {
    organizationId,
    occurredAt: first.occurredAt,
    actorUserId: options.actorUserId,
    memo: options.memo,
  }

  if (kind === 'build') {
    const buildId = rows.find((row) => row.buildId)!.buildId!
    const build = await getBuild(db, organizationId, buildId)
    if (build.isErr()) throw build.error
    if (!build.value) {
      throw new UnprocessableEntityError(`Build ${buildId} was not found`, { buildId })
    }
    // The document is the build, whatever subset of its legs the caller holds.
    const legs = await readBuildMovements(db, organizationId, buildId)
    if (legs.some((leg) => leg.extendedCost == null)) {
      throw new UnprocessableEntityError(
        'This build still has a leg waiting for a standard cost, so its entry cannot be posted yet',
        { buildId }
      )
    }
    return postInventoryMovementInTx(tx, {
      ...base,
      ...buildDocumentPosting(build.value),
      occurredAt: build.value.completedAt ?? first.occurredAt,
      movements: legs
        .filter((leg) => leg.extendedCost !== 0)
        .map((leg) =>
          toLine({
            id: leg.movementId,
            partInstanceId: leg.partId,
            type: leg.type,
            quantity: leg.quantity,
            extendedCost: leg.extendedCost as number,
            glRole: leg.glRole,
            occurredAt: first.occurredAt,
          })
        ),
    })
  }

  const movements = rows.filter((row) => row.extendedCost !== 0).map(toLine)
  if (kind === 'sale') {
    const parents = await readFulfillmentParents(db, organizationId, first.fulfillmentLineId)
    return postInventoryMovementInTx(tx, {
      ...base,
      kind,
      subject: { sourceKind: 'stock_movement', sourceId: first.id },
      ...(parents ? { parents: saleDocumentParents(parents.fulfillmentId, parents.orderId) } : {}),
      cogsSplit: await readSaleCogsSplit(db, organizationId, rows),
      movements,
    })
  }

  return postInventoryMovementInTx(tx, {
    ...base,
    kind,
    subject: { sourceKind: 'stock_movement', sourceId: first.id },
    movements,
  })
}

/** {@link postInventoryDocumentInTx} in its own transaction, then the export hand-off. */
export async function postInventoryDocument(
  db: Database,
  organizationId: string,
  rows: readonly InventoryDocumentRow[],
  options: PostInventoryDocumentOptions = {}
): Promise<PostResult | null> {
  const post = await db.transaction((tx) =>
    postInventoryDocumentInTx(tx, organizationId, rows, options)
  )
  if (post && post.status !== 'posted' && post.status !== 'already_posted') {
    logger.warn('An inventory document was not accepted by the ledger', {
      organizationId,
      movementIds: rows.map((row) => row.id),
      status: post.status,
      error: post.error,
    })
  }
  return exportInventoryMovement(db, post)
}

/** The labour and overhead share of a relief pass, by each row's part standard as it stands now (§1.4: "read again here"). */
async function readSaleCogsSplit(
  db: Database,
  organizationId: string,
  rows: readonly InventoryDocumentRow[]
): Promise<ReliefCogsSplit> {
  const partIds = [
    ...new Set(rows.flatMap((row) => (row.partInstanceId ? [row.partInstanceId] : []))),
  ]
  const standards = await readStandardCost(db, organizationId, partIds)
  if (standards.isErr()) throw standards.error
  return sumReliefCogsSplit(
    rows.map((row) => ({
      extendedCost: row.extendedCost,
      quantity: row.quantity,
      standard: row.partInstanceId ? (standards.value.get(row.partInstanceId) ?? null) : null,
    }))
  )
}

/** The dispatch and order behind a fulfillment line, or `null` when either edge is missing. */
export async function readFulfillmentParents(
  db: Database | Transaction,
  organizationId: string,
  fulfillmentLineId: string | null | undefined
): Promise<{ fulfillmentId: string; orderId: string } | null> {
  if (!fulfillmentLineId) return null
  const parents = await readFulfillmentLineParents(db, organizationId, [fulfillmentLineId])
  return parents.get(fulfillmentLineId) ?? null
}

/** `fulfillmentLineId -> { fulfillmentId, orderId }` for the lines both edges resolve for. */
export async function readFulfillmentLineParents(
  db: Database | Transaction,
  organizationId: string,
  fulfillmentLineIds: readonly string[]
): Promise<Map<string, { fulfillmentId: string; orderId: string }>> {
  const out = new Map<string, { fulfillmentId: string; orderId: string }>()
  const ids = [...new Set(fulfillmentLineIds)]
  if (ids.length === 0) return out
  const ctx = await loadFulfillmentFieldContext(db, organizationId)
  if (!ctx) return out

  const lines = await readSystemRecords(db, organizationId, ctx.line, {
    ids,
    includeArchived: true,
  })
  const fulfillmentByLine = new Map<string, string>()
  for (const line of lines) {
    const fulfillmentId = line.related('fulfillment_line_fulfillment')
    if (fulfillmentId) fulfillmentByLine.set(line.id, fulfillmentId)
  }
  if (fulfillmentByLine.size === 0) return out

  const fulfillments = await readSystemRecords(db, organizationId, ctx.fulfillment, {
    ids: [...new Set(fulfillmentByLine.values())],
    includeArchived: true,
  })
  const orderByFulfillment = new Map<string, string>()
  for (const fulfillment of fulfillments) {
    const orderId = fulfillment.related('fulfillment_order')
    if (orderId) orderByFulfillment.set(fulfillment.id, orderId)
  }
  for (const [lineId, fulfillmentId] of fulfillmentByLine) {
    const orderId = orderByFulfillment.get(fulfillmentId)
    if (orderId) out.set(lineId, { fulfillmentId, orderId })
  }
  return out
}

/** A stored row with its basis, so a caller can tell a pending row from a valued one before posting. */
export interface StoredInventoryDocumentRow extends Omit<InventoryDocumentRow, 'extendedCost'> {
  unitCost: number | null
  extendedCost: number | null
  costBasis: string | null
  pending: boolean
}

/** These movements as the poster reads them, in ledger (`effectiveAt`) order. */
export async function readInventoryDocumentRows(
  db: Database | Transaction,
  organizationId: string,
  movementIds: readonly string[]
): Promise<StoredInventoryDocumentRow[]> {
  if (movementIds.length === 0) return []
  const rows = await readMovementsByIds(db, organizationId, movementIds)
  return rows.map(toInventoryDocumentRow)
}

/** A `StockMovement` row as the document poster reads it. */
export function toInventoryDocumentRow(row: StockMovementRow): StoredInventoryDocumentRow {
  return {
    id: row.id,
    partInstanceId: row.partId,
    type: row.type,
    quantity: row.quantity,
    unitCost: row.unitCostMinor,
    extendedCost: row.extendedCostMinor,
    costBasis: row.costBasis,
    pending: row.costBasis === StockMovementCostBasis.PENDING,
    glRole: row.glRole,
    occurredAt: row.effectiveAt,
    fulfillmentLineId: row.fulfillmentLineId,
    buildId: row.buildId,
    vendorUnitPrice: row.vendorUnitPriceMinor,
    freightAccrued: row.freightAccruedMinor,
    dutiesAccrued: row.dutiesAccruedMinor,
  }
}

/** A stored row that is valued, as the poster takes it. Throws on a pending or costless row. */
export function valuedDocumentRow(row: StoredInventoryDocumentRow): InventoryDocumentRow {
  if (row.pending || row.extendedCost == null) {
    throw new UnprocessableEntityError(
      `Stock movement ${row.id} has no cost yet and cannot be posted`,
      { movementId: row.id }
    )
  }
  return { ...row, extendedCost: row.extendedCost }
}
