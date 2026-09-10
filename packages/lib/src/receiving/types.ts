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
   * Nullable in the TYPE only because pre-migration rows exist; every writer in
   * this module now refuses to produce a row without a cost, INCLUDING a
   * negative stock adjustment — decision `G12` values a removal at the part's
   * frozen `part_standard_cost` exactly as it values an addition.
   */
  unitCost: number | null
  /** `round(unitCost x quantity)`, signed like `quantity`; `null` with the cost. */
  extendedCost: number | null
  /** Raw supplier price per unit, whole minor units; `null` when not known. */
  vendorUnitPrice: number | null
  vendorPartId: string | null
  /**
   * The inventory account ROLE ('inventory_raw_materials'), never an account
   * code and never a provider id (decision `G8` — the field name predates it).
   */
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
 *
 * 🛑 **There is no `unitCost` here, and there must not be one.** Decision `G12`
 * makes an adjustment carry the part's own frozen `part_standard_cost`, read by
 * the SERVER, in both directions. An adjustment has no supplier row, no purchase
 * order and no packing slip, so there is no ACTUAL for a caller to state — a
 * typed number would make the ledger's valuation depend on who was counting.
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
 * A part's opening balance: the quantity and unit cost it starts life holding
 * (plans/money/tasks/15-costing-usability.md section 2.2).
 *
 * 🛑 **Not an adjustment and not a receipt.** It is written once, by the create
 * form, as `StockMovementType.INITIAL`. See `open-stock-balance.ts` for why this
 * is the one movement type whose cost a caller is entitled to state.
 */
export interface OpenStockBalanceInput {
  /** `EntityInstance.id` of the `part`. */
  partId: string
  /** Units on hand at the opening date. Strictly positive. */
  quantity: number
  /**
   * What a unit cost, in whole minor units. Strictly positive.
   *
   * Becomes the part's first `part_standard_cost` as well as this movement's
   * frozen `unit_cost`, so the two agree by construction and the opening
   * balance carries no variance.
   */
  unitCost: number
  /**
   * The ACCOUNTING date. Defaults to now.
   *
   * 🛑 Load-bearing for the close: an `initial` movement dated at or before
   * `accounting.cutoffPeriod` falls outside the month-end window and is covered
   * by the frozen `accounting.opening*` baseline; one dated after it is summed
   * into inventory. Both are correct and the date is what chooses.
   */
  occurredAt?: Date
  /** Free text: 'Opening count 2026-01-01'. */
  notes?: string
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

/**
 * One part on the Parts > Settings > Costing opening-stock checklist
 * (plans/money/tasks/52-parts-costing-page.md §4).
 *
 * Every one of the five row states is derivable from these fields, and no state
 * needs a second read to render. The two suggestion inputs travel with the row
 * for the same reason: `shouldSuggestFinishedGood` needs `hasProduct` and
 * `isSubpartOfAssembly` together, and a row that had one and not the other would
 * flash the wrong suggestion while the second read landed.
 */
export interface OpeningStockCandidate {
  /** `EntityInstance.id` of the `part`. */
  partId: string
  /**
   * The part's display name, empty rather than null.
   *
   * `EntityInstance.displayName` is nullable in the column, but a checklist row
   * with no name is still a row somebody has to look at, so the absence is
   * flattened here rather than pushed onto every renderer.
   */
  title: string
  sku: string | null
  /**
   * The raw stored `part_kind`: `component`, `subassembly`, `finished_good` or
   * `null`.
   *
   * 🛑 Gate the suggestion on `isPartKindUnclassified`, NOT a null check. The
   * field carries `defaultValue: 'component'`, so a stored `component` no longer
   * proves a human chose it.
   */
  partKind: string | null
  /**
   * The frozen `part_standard_cost`, minor units at `RATE_DECIMALS`.
   *
   * 🛑 This, and never `part_cost`, is what an opening cost defaults from.
   * `part_cost` is LIVE replacement cost, rewritten on every vendor-price
   * change; seeding a movement's frozen value from it would seed the ledger
   * from the one field that must never value a movement (HANDOFF rule 2).
   */
  standardCost: number | null
  /**
   * The part has at least one `stock_movement`, archived ones included, so
   * `bulkOpenStockBalance` will EXCLUDE it. Opening is once.
   */
  hasMovements: boolean
  /** One of those movements is `initial`: the part is already opened. */
  hasInitialMovement: boolean
  /** Condition (a) of `shouldSuggestFinishedGood`: the part has a `product`. */
  hasProduct: boolean
  /** Condition (b), inverted: some `subpart` row names this part as its CHILD. */
  isSubpartOfAssembly: boolean
}

/** One line of a bulk opening balance: this many of this part, at this cost. */
export interface OpeningStockEntry {
  /** `EntityInstance.id` of the `part`. */
  partId: string
  /** Units on hand at the opening date. Strictly positive. */
  quantity: number
  /**
   * What a unit cost, minor units at `RATE_DECIMALS`. Strictly positive.
   *
   * 🛑 NOT rounded into a legal value if it is finer than that. See
   * `bulk-opening-stock.ts`.
   */
  unitCost: number
}

/**
 * A whole org's opening balance, as one run.
 *
 * 🛑 **One date for the whole run, not one per row.** `openStockBalance` takes
 * `occurredAt` per part because it opens one part, but an opening balance is one
 * event on one date, and exposing it per row invites 495 dates for it.
 */
export interface BulkOpeningStockInput {
  /**
   * The ACCOUNTING date stamped on every movement in the run.
   *
   * 🛑 Load-bearing for the close: an `initial` movement dated at or before
   * `accounting.cutoffPeriod` falls outside the month-end window and is covered
   * by the frozen `accounting.opening*` baseline; one dated after it is summed
   * into inventory. Both are correct and the date is what chooses.
   */
  occurredAt?: Date
  entries: OpeningStockEntry[]
}

/**
 * Why one part of a bulk opening run produced no movement.
 *
 * The split between EXCLUDED and FAILED is the difference between "this is
 * correct and expected" and "somebody needs to look at this":
 *
 * | reason | bucket | meaning |
 * | --- | --- | --- |
 * | `already_has_movements` | excluded | opening is once; this part's ledger already started |
 * | `duplicate_entry` | excluded | named twice in one run; the first entry was used |
 * | `invalid_quantity` | failed | not finite, or not above zero |
 * | `invalid_unit_cost` | failed | not finite, not above zero, or finer than `RATE_DECIMALS` |
 * | `unknown_part` | failed | no such part in this org, or it is archived |
 * | `no_standard_cost` | failed | the part would have been left holding stock nothing can value |
 * | `write_failed` | failed | the movement itself was refused |
 */
export type OpeningStockSkipReason =
  | 'already_has_movements'
  | 'duplicate_entry'
  | 'invalid_quantity'
  | 'invalid_unit_cost'
  | 'unknown_part'
  | 'no_standard_cost'
  | 'write_failed'

/**
 * One part that produced no movement, carrying the reason that proves it.
 *
 * ⚠️ Every excluded row carries its own explanation rather than a count at the
 * top, which is 44 §7.2b's rule and what the backfill and post-fulfillments
 * dialogs both already do.
 */
export interface OpeningStockSkip {
  partId: string
  reason: OpeningStockSkipReason
  /** Human-readable, and specific to this part. Safe to render as-is. */
  detail: string
}

/** One part that WAS opened, and the ledger row it produced. */
export interface OpenedOpeningStockRow {
  partId: string
  /** `EntityInstance.id` of the created `stock_movement`. */
  movementId: string
  /** `<entityDefinitionId>:<instanceId>`, ready for a drawer or a picker. */
  recordId: string
  quantity: number
  /** The TYPED cost, minor units, exactly as stored. */
  unitCost: number
  /** `round(unitCost x quantity)`, exactly as stored. */
  extendedCost: number
  /**
   * The inventory account ROLE ('inventory_raw_materials'), never an account
   * code and never a provider id (decision `G8`).
   */
  glAccount: string
}

/**
 * What a bulk opening run did, and what it did not do.
 *
 * `opened.length + excluded.length + failed.length === requested`: every entry
 * the caller sent is accounted for by exactly one row.
 */
export interface BulkOpeningStockSummary {
  /** The single date every movement in the run was stamped with. */
  occurredAt: Date
  /** How many entries the caller sent, duplicates included. */
  requested: number
  opened: OpenedOpeningStockRow[]
  excluded: OpeningStockSkip[]
  failed: OpeningStockSkip[]
  /**
   * The opening journal entry, by inventory account role.
   *
   * The sum of every opening balance IS the opening inventory on the balance
   * sheet, and nobody can check the run without the per-account split.
   */
  totalsByGlAccount: Array<{ glAccount: string; partCount: number; extendedCost: number }>
}
