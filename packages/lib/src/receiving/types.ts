// packages/lib/src/receiving/types.ts

/**
 * Input and output shapes for the receipt write path
 * (plans/purchasing/01-build-plan.md section 3.2).
 *
 * Every monetary value here is an INTEGER in minor units (cents) — the platform
 * `FieldType.CURRENCY` convention. The one place a fraction legitimately appears
 * is inside the landed-cost calculation, and it is rounded away before it
 * reaches any field on these types.
 */

import type { AllocationBasis } from '../purchasing/types'

/** A single-line receipt: this many of this part arrived, at this price. */
export interface ReceiveStockInput {
  /** `EntityInstance.id` of the `part` being received. */
  partId: string
  /**
   * Units received. Must be greater than zero.
   *
   * A negative receipt is not a correction, it is a vendor return, and it
   * belongs to `type: 'return_out'` with the original receipt's frozen cost
   * copied onto it (build plan section 3.4). Accepting a negative here would
   * value the return at today's price, which is the exact costing bug this
   * subsystem exists to avoid.
   */
  quantity: number
  /** `EntityInstance.id` of the `vendor_part` row that priced this, if known. */
  vendorPartId?: string
  /**
   * The raw supplier price per unit, minor units, before landed adders.
   *
   * Frozen onto the movement as provenance: the three-way match compares the
   * vendor's bill against what was *invoiced*, not against the landed cost, so
   * without this the match has nothing to compare to.
   */
  vendorUnitPrice?: number
  /**
   * The landed cost per unit, minor units. Supplied here it WINS over anything
   * derivable from the `vendor_part` row — that is the point of the editable
   * price input on the Receive form. The vendor's actual invoice beats the
   * standing terms every time.
   */
  unitCost?: number
  /**
   * The ACCOUNTING date. Defaults to now.
   *
   * Not `createdAt`: that column records when the paperwork was typed, and the
   * pallet that lands on Thursday is routinely keyed on Monday. Without a
   * separate date every period boundary falls on the wrong side (build plan
   * section 2.2).
   */
  occurredAt?: Date
  /** Packing slip or vendor invoice number. */
  reference?: string
  /** Free text, for corrections and anything the reference does not explain. */
  reason?: string
  /** `EntityInstance.id` of the `purchase_order_line` this satisfies, if any. */
  purchaseOrderLineId?: string
}

/**
 * What a write returns: enough to render the row that was just created and to
 * link to it, without a second read.
 *
 * Every money field is the value actually STORED — already rounded — so a caller
 * that echoes this back to the user is showing the ledger, not its own
 * arithmetic.
 */
export interface MovementRecord {
  /** `EntityInstance.id` of the created `stock_movement`. */
  movementId: string
  /** `<entityDefinitionId>:<instanceId>`, ready for a drawer or a picker. */
  recordId: string
  partInstanceId: string
  /** Positive for a receipt. */
  quantity: number
  /** Landed cost per unit, whole minor units. */
  unitCost: number
  /** `round(unitCost x quantity)`, signed like `quantity`. */
  extendedCost: number
  /** Raw supplier price per unit, whole minor units; `null` when not known. */
  vendorUnitPrice: number | null
  vendorPartId: string | null
  /** The inventory account CODE ('1310'), never a provider id. */
  glAccount: string
  occurredAt: Date
  purchaseOrderLineId: string | null
}

/** One line of a multi-line purchase-order receipt. */
export interface ReceivePurchaseOrderLineInput {
  /** `EntityInstance.id` of the `part` on this line. */
  partId: string
  /** `EntityInstance.id` of the `purchase_order_line` being received against. */
  purchaseOrderLineId: string
  /** Units received on this line. Must be greater than zero. */
  quantity: number
  /**
   * The agreed buy price per unit, minor units, BEFORE any header freight/tax is
   * spread onto it. This is what gets frozen as `vendorUnitPrice`; the allocation
   * turns it into the landed `unitCost`.
   */
  unitPrice: number
  /** `EntityInstance.id` of the `vendor_part` row, if the line names one. */
  vendorPartId?: string
  /** Shipping weight for the whole line — read only by the `weight` basis. */
  weight?: number
}

/** The header totals a purchase-order receipt spreads across its lines. */
export interface ReceivePurchaseOrderInput {
  lines: ReceivePurchaseOrderLineInput[]
  /** Freight charged on the purchase as a whole, minor units. */
  shipping?: number
  /** Tax charged on the purchase as a whole, minor units. */
  tax?: number
  /** Header-level discount, minor units. Subtracted from what is capitalised. */
  discount?: number
  /**
   * True when the buyer reclaims input tax, in which case tax is NOT capitalised
   * into inventory. Defaults to false, matching the header field's own default.
   */
  taxRecoverable?: boolean
  /** What the header totals are spread in proportion to. Defaults to `value`. */
  basis?: AllocationBasis
  /** The accounting date stamped on every movement in this receipt. */
  occurredAt?: Date
  /** Packing slip or vendor invoice number, stamped on every movement. */
  reference?: string
  /** Free text, stamped on every movement. */
  reason?: string
}

/** One `receive` movement as the read path returns it. */
export interface ReceiptRow {
  movementId: string
  recordId: string
  partInstanceId: string | null
  quantity: number
  /** `null` for a pre-phase-1 movement, which is non-postable and stays that way. */
  unitCost: number | null
  extendedCost: number | null
  vendorUnitPrice: number | null
  vendorPartId: string | null
  glAccount: string | null
  purchaseOrderLineId: string | null
  reference: string | null
  /**
   * The accounting date, falling back to `createdAt` when the movement predates
   * `occurredAt` existing. The fallback is a READ-time convenience only — build
   * plan section 2.5 is explicit that historic rows are never backfilled.
   */
  occurredAt: Date
  createdAt: Date
}

/** Narrowing options for the receipt read path. */
export interface ListReceiptsFilters {
  /** Only receipts for this `part` instance. */
  partInstanceId?: string
  /** Only receipts priced by this `vendor_part` instance. */
  vendorPartId?: string
  /** Only receipts whose accounting date is at or after this instant. */
  since?: Date
  /** Only receipts whose accounting date is at or before this instant. */
  until?: Date
  /** Defaults to 50. */
  limit?: number
  offset?: number
}
