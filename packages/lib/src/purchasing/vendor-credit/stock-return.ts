// packages/lib/src/purchasing/vendor-credit/stock-return.ts

/**
 * The stock half of a supplier return (73 §8.2): the goods on a flagged credit
 * line go back out the door as one `return_out` movement at the part's current
 * standard, and the credit's transaction posts one `return_to_vendor` entry
 * beside its money entry.
 *
 * 🛑 The receipt REVERSAL (`inventory/movements/reverse-movement.ts`) is not
 * this door and never should be: it un-books the receipt as if the goods never
 * arrived, which leaves the order line short-received against a bill nobody
 * credited.
 *
 * No permission checks here. The router asserts (docs/lib-module-guide.md §6).
 */

import type { Database, Transaction } from '@auxx/database'
import type { InventoryMovementLine } from '../../accounting/ledger/builders/inventory-movement'
import type { InTxPostResult } from '../../accounting/ledger/post/post-entry'
import {
  inventoryTxnDate,
  postInventoryMovementInTx,
} from '../../accounting/ledger/post/post-inventory-movement'
import { requireCachedEntityDefId } from '../../cache'
import { UnprocessableEntityError } from '../../errors'
import { readStandardCost } from '../../inventory/costing/standard-cost-queries'
import { type StockMovementInput, writeStockMovements } from '../../inventory/movements'
import { resolveInventoryRoleForPartKind } from '../../inventory/movements/client'
import { readPartKind } from '../../inventory/receiving/receipt-queries'
import { StockMovementType } from '../../resources/registry/enum-values'
import { systemDefId } from '../../resources/system-records'
import type { VendorCreditLineRecord } from './reads'

/** One flagged credit line, resolved to everything the movement and the entry need. */
export interface VendorCreditStockReturn {
  lineId: string
  partInstanceId: string
  /** POSITIVE. The movement is written at `-quantity`: the goods leave. */
  quantity: number
  /** `part_standard_cost`, whole minor units per unit. */
  standardUnitCost: number
  /** The inventory ROLE the part's kind resolves to, never an account code. */
  glAccountRole: string
  purchaseOrderLineInstanceId: string | null
  /**
   * `vendor_credit_line_line_total` — what the supplier is crediting for these
   * units, which is exactly what the credit's money entry credits `grni` for.
   * Reading the PO line's agreed price instead would leave a residue in `grni`
   * whenever the vendor credits a different figure from the one on the order,
   * and `grni` exists to net to zero per line.
   */
  grniReliefMinor: number
}

/** A line's name in a refusal: what the supplier called it, else its position. */
function label(line: VendorCreditLineRecord, index: number): string {
  return line.description?.trim() || `Line ${index + 1}`
}

/**
 * Resolve every flagged line into a return, refusing by name.
 *
 * `[]` when nothing is flagged — the ordinary price-adjustment or
 * short-shipment credit, which moves no stock at all.
 *
 * @throws {UnprocessableEntityError} when a flagged line names no part, carries
 *   no positive quantity, or its part has no standard cost to value the return
 *   at. Batched, so four bad lines are named in one refusal.
 */
export async function planVendorCreditStockReturns(
  db: Database,
  organizationId: string,
  lines: readonly VendorCreditLineRecord[]
): Promise<VendorCreditStockReturn[]> {
  const flagged = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.returnsStock)
  if (flagged.length === 0) return []

  const refusals: string[] = []
  const withPart: Array<{ line: VendorCreditLineRecord; index: number }> = []
  for (const entry of flagged) {
    const { line, index } = entry
    if (!line.partInstanceId) {
      refusals.push(`${label(line, index)} has no part, so there is nothing to send back`)
      continue
    }
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      refusals.push(`${label(line, index)} returns stock but has no quantity`)
      continue
    }
    withPart.push(entry)
  }

  const partIds = [...new Set(withPart.map(({ line }) => line.partInstanceId as string))]
  const standards = await readStandardCost(db, organizationId, partIds)
  if (standards.isErr()) throw standards.error

  const returns: VendorCreditStockReturn[] = []
  for (const { line, index } of withPart) {
    const partInstanceId = line.partInstanceId as string
    const standardUnitCost = standards.value.get(partInstanceId)?.standardCost ?? 0
    if (!standardUnitCost || standardUnitCost <= 0) {
      refusals.push(
        `${label(line, index)} has no standard cost on its part, so the return cannot be valued`
      )
      continue
    }
    const kind = await readPartKind(db, organizationId, partInstanceId)
    if (kind.isErr()) throw kind.error
    returns.push({
      lineId: line.id,
      partInstanceId,
      quantity: line.quantity,
      standardUnitCost,
      glAccountRole: resolveInventoryRoleForPartKind(kind.value),
      purchaseOrderLineInstanceId: line.purchaseOrderLineInstanceId,
      grniReliefMinor: line.lineTotalMinor,
    })
  }

  if (refusals.length > 0) {
    throw new UnprocessableEntityError(
      `This vendor credit cannot send stock back: ${refusals.join('; ')}.`,
      { lines: refusals.join('; ') }
    )
  }

  return returns
}

export interface WriteVendorCreditStockReturnsInput {
  organizationId: string
  userId: string
  /** The `vendor_credit` EntityInstance id — the entry's parent. */
  vendorCreditInstanceId: string
  /** `VC-0001`, stamped on every movement as its reference. */
  number: string
  occurredAt: Date
  returns: readonly VendorCreditStockReturn[]
}

export interface WrittenVendorCreditStockReturns {
  movementIds: string[]
  affectedPartIds: string[]
  purchaseOrderLineIds: string[]
  post: InTxPostResult | null
}

/**
 * Write the `return_out` movements and post the one `return_to_vendor` entry, on
 * the CALLER'S transaction — the credit's own, so the goods leaving and the
 * money leaving commit or roll back together.
 *
 * The quantity is NEGATED here and nowhere else: the plan carries what came
 * back off the shelf as a positive number, exactly as the credit line states it.
 */
export async function writeVendorCreditStockReturns(
  tx: Transaction,
  input: WriteVendorCreditStockReturnsInput
): Promise<WrittenVendorCreditStockReturns> {
  const { organizationId, userId, vendorCreditInstanceId, number, occurredAt, returns } = input
  if (returns.length === 0) {
    return { movementIds: [], affectedPartIds: [], purchaseOrderLineIds: [], post: null }
  }

  const txDb = tx as unknown as Database
  const partDefId = await requireCachedEntityDefId(organizationId, 'part')
  const movementDefId = await systemDefId(txDb, organizationId, 'stock_movement')
  if (!movementDefId) {
    throw new UnprocessableEntityError('This organization has no stock_movement entity definition')
  }

  const inputs: StockMovementInput[] = returns.map((item) => ({
    partInstanceId: item.partInstanceId,
    type: StockMovementType.RETURN_OUT,
    quantity: -item.quantity,
    unitCost: item.standardUnitCost,
    costBasis: 'standard',
    glAccount: item.glAccountRole,
    occurredAt,
    reason: 'Returned to vendor',
    reference: number,
    ...(item.purchaseOrderLineInstanceId
      ? { links: { purchaseOrderLineId: item.purchaseOrderLineInstanceId } }
      : {}),
  }))

  const written = await writeStockMovements(
    { db: txDb, organizationId, userId, movementDefId, partDefId, lane: { kind: 'plain' } },
    inputs
  )
  if (written.isErr()) throw written.error
  const records = written.value.records

  // `records` is in `returns` order, so the credited amount pairs by index —
  // filtered together, or a dropped row would take its `grni` debit with it and
  // leave the entry plugging the gap to `ppv`.
  const movements: InventoryMovementLine[] = records
    .map((record, index) => ({ record, item: returns[index]! }))
    .filter(({ record }) => record.glAccount && record.extendedCost !== 0)
    .map(({ record, item }) => ({
      id: record.movementId,
      extendedCostMinor: record.extendedCost,
      glAccountRole: record.glAccount as string,
      grniReliefMinor: item.grniReliefMinor,
    }))

  const post = await postInventoryMovementInTx(tx, {
    organizationId,
    kind: 'return_to_vendor',
    // The FIRST movement anchors the claim, the receipt's shape; every movement
    // — itself included — is linked as a member by the poster.
    subject: { sourceKind: 'stock_movement', sourceId: records[0]!.movementId },
    parent: { sourceKind: 'vendor_credit', sourceId: vendorCreditInstanceId },
    txnDate: inventoryTxnDate(occurredAt),
    movements,
    actorUserId: userId,
    memo: `Returned to vendor on ${number}`,
  })

  return {
    movementIds: records.map((record) => record.movementId),
    affectedPartIds: written.value.affectedPartIds,
    purchaseOrderLineIds: [
      ...new Set(
        returns
          .map((item) => item.purchaseOrderLineInstanceId)
          .filter((id): id is string => id !== null)
      ),
    ],
    post,
  }
}
