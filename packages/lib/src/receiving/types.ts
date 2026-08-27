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
   * The BASE price per unit, minor units, before landed adders.
   *
   * Two jobs, and they are the same number: it is the base the `vendor_part`
   * row's adders sit on top of, and it is frozen onto the movement as
   * provenance for the three-way match, which compares the vendor's bill
   * against what was *invoiced* rather than against the landed cost.
   *
   * 🛑 **Supplied here it is the base — the stored `vendor_part` price is
   * not.** A receipt is keyed against the price on the packing slip in front of
   * the person keying it; the supplier row holds standing terms that may be
   * months old. Reading the stored price as the base while displaying the sent
   * one is how a receipt ends up valued at a number nobody typed. The supplier
   * row is still read, but only for the adders (freight, tariff, other).
   */
  vendorUnitPrice?: number
  /**
   * The ALREADY-RESOLVED landed cost per unit, minor units.
   *
   * 🛑 **An internal seam, not a browser field.** The only caller that sets it
   * is {@link ReceivePurchaseOrderInput}'s write path, which reads the purchase
   * order line's agreed price server-side and hands it down rather than
   * re-deriving it here. A client that could set this could value inventory at
   * any number it asserted, which is why the router's input schema does not
   * accept it.
   *
   * Supplied, it is used as-is: it has already been resolved from an authority
   * the browser does not control. Absent, the price is resolved from
   * {@link vendorUnitPrice} and the `vendor_part` adders.
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
  /** Positive for a receipt; negative for a reversal or a removal. */
  quantity: number
  /**
   * Landed cost per unit, whole minor units.
   *
   * `null` on exactly one shape of row: a NEGATIVE stock adjustment, which
   * consumes value the ledger already carries rather than creating any. See
   * {@link AdjustStockInput.unitCost} — every other writer in this module
   * refuses to produce a row without a cost.
   */
  unitCost: number | null
  /** `round(unitCost x quantity)`, signed like `quantity`; `null` with the cost. */
  extendedCost: number | null
  /** Raw supplier price per unit, whole minor units; `null` when not known. */
  vendorUnitPrice: number | null
  vendorPartId: string | null
  /** The inventory account CODE ('1310'), never a provider id; `null` with the cost. */
  glAccount: string | null
  occurredAt: Date
  purchaseOrderLineId: string | null
}

/**
 * A hand-keyed count correction: the number on the shelf is not the number in
 * the system, and this is the difference
 * (plans/purchasing/05-receiving-cost-and-corrections.md section 1.5).
 *
 * 🛑 **This is not a receipt and it is not a reversal.** A receipt is a purchase
 * with a supplier and a packing slip; a reversal undoes a specific movement and
 * carries that movement's frozen cost. An adjustment has neither — it is the
 * answer to "we counted, and there are three more than we thought".
 */
export interface AdjustStockInput {
  /** `EntityInstance.id` of the `part` being adjusted. */
  partId: string
  /**
   * The signed delta. Positive adds stock, negative removes it.
   *
   * Zero is refused rather than treated as a no-op: a movement of zero is a row
   * in an append-only ledger that changes nothing and can never be removed.
   */
  quantity: number
  /**
   * What one added unit is worth, minor units. REQUIRED when {@link quantity}
   * is positive, and ignored when it is negative.
   *
   * 🛑 **The asymmetry is the contract, not an oversight.** A positive
   * adjustment CREATES inventory value out of nothing and something has to say
   * what that value is; writing it at zero understates COGS and drags the
   * part's average cost toward zero, which is the defect section 1.5 of the
   * plan documents. A negative adjustment CONSUMES value the ledger already
   * carries, and answering "at what cost" correctly needs a costing method
   * (FIFO, moving average, specific identification) that this system does not
   * have yet. Guessing one here would freeze the guess onto an `updatable:
   * false` row forever, so a removal is written with no cost at all until that
   * method exists.
   */
  unitCost?: number
  /**
   * The ACCOUNTING date. Defaults to now.
   *
   * Not `createdAt`: a stock count taken on Friday is routinely keyed on
   * Monday, and without a separate date every period boundary falls on the
   * wrong side.
   */
  occurredAt?: Date
  /** Free text: 'Recount', 'Damaged goods'. */
  reason?: string
  /** An external document number, if the correction has one. */
  reference?: string
}

/**
 * One line of a multi-line purchase-order receipt.
 *
 * 🛑 **No price.** The agreed price is already on the `purchase_order_line`, and
 * the write path reads it there. A line carries only the two facts the
 * receiving door is entitled to state: which line arrived, and how many.
 */
export interface ReceivePurchaseOrderLineInput {
  /** `EntityInstance.id` of the `part` on this line. */
  partId: string
  /** `EntityInstance.id` of the `purchase_order_line` being received against. */
  purchaseOrderLineId: string
  /** Units received on this line. Must be greater than zero. */
  quantity: number
  /** `EntityInstance.id` of the `vendor_part` row, if the line names one. */
  vendorPartId?: string
}

/**
 * A multi-line purchase-order receipt.
 *
 * 🛑 **No header freight, tax or discount.** Those are ORDER-level amounts and a
 * receipt is a SHIPMENT-level event; spreading them at every receipt capitalises
 * the same freight once per delivery. They stay on the purchase order, and the
 * landed-cost allocation moves to the bill, which is the document that actually
 * states what the freight was (plans/purchasing/05-receiving-cost-and-corrections.md
 * sections 3.2 and 4.2).
 */
export interface ReceivePurchaseOrderInput {
  lines: ReceivePurchaseOrderLineInput[]
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
