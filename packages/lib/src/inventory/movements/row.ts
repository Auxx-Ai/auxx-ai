// packages/lib/src/inventory/movements/row.ts

import type { CreateStockMovementInput } from '@auxx/database'
import type { StockMovementCostBasisValue, StockMovementTypeValue } from '@auxx/database/enums'
import { StockMovementCostBasisValues, StockMovementTypeValues } from '@auxx/database/enums'
import { UnprocessableEntityError } from '../../errors'
import { computeExtendedCost } from './client'
import type { StockMovementInput } from './types'

/** Who and when a row is written, beside its input. */
export interface StockMovementRowMeta {
  id: string
  organizationId: string
  userId: string | null
  createdAt: Date
}

/**
 * The `StockMovement` insert row for one input, after the ledger's write rules: a quantity of 0 only
 * on `revalue`, a null cost exactly on `pending`, a count fact only on `initial`, whole-minor amounts.
 */
export function toStockMovementRow(
  meta: StockMovementRowMeta,
  input: StockMovementInput
): CreateStockMovementInput {
  const type = assertType(input.type)
  const costBasis = input.costBasis === undefined ? null : assertCostBasis(input.costBasis)
  assertMovableQuantity(type, input.quantity)

  const pending = costBasis === 'pending'
  if (pending ? input.unitCost != null || input.extendedCost != null : input.unitCost == null) {
    throw new UnprocessableEntityError(
      pending
        ? 'A pending stock movement carries no cost until it is priced'
        : 'A stock movement with no unit cost must be written with a pending cost basis',
      { type }
    )
  }
  if (input.count && type !== 'initial') {
    throw new UnprocessableEntityError('Only an initial movement carries a count fact', { type })
  }

  const extendedCost =
    input.unitCost == null
      ? null
      : wholeMinor(input.extendedCost ?? computeExtendedCost(input.unitCost, input.quantity))
  const links = input.links ?? {}

  return {
    id: meta.id,
    organizationId: meta.organizationId,
    createdById: meta.userId,
    createdAt: meta.createdAt,
    partId: input.partInstanceId,
    type,
    quantity: input.quantity,
    reason: input.reason || null,
    reference: input.reference || null,
    // The seam explodes the BOM in the same write, so the stored row is already settled.
    adjustSubparts: false,
    unitCostMinor: input.unitCost,
    extendedCostMinor: extendedCost,
    costBasis,
    glRole: input.glRole ?? null,
    occurredAt: input.occurredAt,
    vendorUnitPriceMinor: input.vendorUnitPrice ?? null,
    // A zero accrual is stored as null: "not a receipt", not "we checked, it was free".
    freightAccruedMinor: input.accrued?.freightMinor
      ? wholeMinor(input.accrued.freightMinor)
      : null,
    dutiesAccruedMinor: input.accrued?.dutiesMinor ? wholeMinor(input.accrued.dutiesMinor) : null,
    tariffRate: input.accrued?.tariffRate || null,
    qtyPerUnit: input.qtyPerUnit ?? null,
    countQuantity: input.count?.quantity ?? null,
    countDate: input.count?.date ?? null,
    vendorPartId: links.vendorPartId ?? null,
    purchaseOrderLineId: links.purchaseOrderLineId ?? null,
    buildId: links.buildId ?? null,
    reversesMovementId: links.reversesMovementId ?? null,
    parentMovementId: links.parentMovementId ?? null,
    fulfillmentLineId: links.fulfillmentLineId ?? null,
    returnPartLineId: links.returnPartLineId ?? null,
  }
}

function assertType(type: string): StockMovementTypeValue {
  if ((StockMovementTypeValues as readonly string[]).includes(type)) {
    return type as StockMovementTypeValue
  }
  throw new UnprocessableEntityError(`Unknown stock movement type "${type}"`, { type })
}

function assertCostBasis(basis: string): StockMovementCostBasisValue {
  if ((StockMovementCostBasisValues as readonly string[]).includes(basis)) {
    return basis as StockMovementCostBasisValue
  }
  throw new UnprocessableEntityError(`Unknown stock movement cost basis "${basis}"`, { basis })
}

/** Only `revalue` is cost-only (73 §6.2 rule 2); the table's check constraint says the same. */
function assertMovableQuantity(type: StockMovementTypeValue, quantity: number): void {
  if (!Number.isFinite(quantity)) {
    throw new UnprocessableEntityError('A stock movement quantity must be a finite number', {
      type,
    })
  }
  if (quantity !== 0 || type === 'revalue') return
  throw new UnprocessableEntityError(
    `A ${type} movement of zero quantity changes nothing. Only a revalue movement is cost-only.`,
    { type }
  )
}

/** Amounts are `bigint` minor units; a fraction is a caller bug, not something to round away. */
function wholeMinor(amount: number): number {
  if (!Number.isInteger(amount)) {
    throw new UnprocessableEntityError('A stock movement amount must be whole minor units', {
      amount: String(amount),
    })
  }
  // `|| 0`: a $0 cost on a negative quantity rounds to `-0`.
  return amount || 0
}
