// packages/lib/src/inventory/movements/types.ts

import type { Database, Transaction } from '@auxx/database'

/** The links a movement may carry; every value is a BARE `EntityInstance` / `StockMovement` id. */
export interface StockMovementLinks {
  vendorPartId?: string
  purchaseOrderLineId?: string
  buildId?: string
  reversesMovementId?: string
  parentMovementId?: string
  fulfillmentLineId?: string
  returnPartLineId?: string
}

/** One `StockMovement` row to write. */
export interface StockMovementInput {
  /** `EntityInstance.id` of the `part` this movement is against. */
  partInstanceId: string
  /** A `StockMovementType` value. */
  type: string
  /** SIGNED. The sign convention lives here and nowhere else. */
  quantity: number
  /** Minor units, up to 3 decimals. `null` exactly when `costBasis` is `pending` (111 Q18). */
  unitCost: number | null
  /** A `StockMovementCostBasis` value; omit only for a reversal of a row that carried none. */
  costBasis?: string
  /** An inventory ROLE (`resolveInventoryRoleForPartKind`), never a code. */
  glRole?: string
  occurredAt: Date
  /** Override for `computeExtendedCost(unitCost, quantity)`; must be whole minor units. */
  extendedCost?: number
  /** Explode this movement through the part's BOM (§8.2). No current writer opts in. */
  adjustSubparts?: true
  reason?: string
  reference?: string
  links?: StockMovementLinks
  /** The as-built BOM snapshot. `null`/absent is the OFF-BOM marker - never write a 0. */
  qtyPerUnit?: number | null
  /** Three-way-match provenance, receipts only. Minor units, up to 3 decimals. */
  vendorUnitPrice?: number
  /** What a receipt credited `freight_accrual` / `duties_accrual` (73 §7.2); whole minor units. */
  accrued?: {
    freightMinor?: number
    dutiesMinor?: number
    /** A PERCENTAGE - `25` means 25%. */
    tariffRate?: number
  }
  /** The count fact an `initial` anchor is derived from (111 Q26): `setCount` is the only writer. */
  count?: StockMovementCountFact
}

/** "N as of D": what was counted, and the book-zone calendar day it was counted on. */
export interface StockMovementCountFact {
  quantity: number
  /** `YYYY-MM-DD` in the book time zone. */
  date: string
}

/** One movement a write produced, in input order. BOM children are not listed here. */
export interface WrittenStockMovement {
  /** The `StockMovement.id`. */
  id: string
  partInstanceId: string
  quantity: number
  /** `null` on a pending row; the entry builder must never see one. */
  unitCost: number | null
  extendedCost: number | null
  glRole: string | null
  occurredAt: Date
}

/** What a write or delete changed, for {@link settleStockMovements} after the commit. */
export interface StockMovementTouched {
  partIds: string[]
  purchaseOrderLineIds: string[]
  fulfillmentLineIds: string[]
  buildIds: string[]
}

/** What a `writeStockMovements` call did. */
export interface WriteStockMovementsResult {
  /** In the same order as the `inputs` array. */
  records: WrittenStockMovement[]
  /** Includes the parts of any BOM children. Hand it to `settleStockMovements` after the commit. */
  touched: StockMovementTouched
}

/** Where a movement write runs; pass the caller's transaction so rows and postings commit together. */
export interface StockMovementsCtx {
  db: Database | Transaction
  organizationId: string
  userId: string
}

/** What a receive / adjust door returns: enough to render and link the new row without a re-read. */
export interface MovementRecord {
  /** The `StockMovement.id`. */
  id: string
  partInstanceId: string
  /** Positive for a receipt; negative for a reversal or a removal. */
  quantity: number
  /** Landed cost per unit in minor units; `null` on a pending row. */
  unitCost: number | null
  /** `round(unitCost x quantity)`, signed like `quantity`; `null` with the cost. */
  extendedCost: number | null
  /** Raw supplier price per unit in minor units; `null` when not known. */
  vendorUnitPrice: number | null
  vendorPartId: string | null
  /** The inventory account ROLE (decision G8). */
  glRole: string | null
  occurredAt: Date
  purchaseOrderLineId: string | null
}
