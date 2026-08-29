// apps/web/src/server/api/routers/purchasing.ts

import { getCachedEntityDefId } from '@auxx/lib/cache'
import { NotFoundError } from '@auxx/lib/errors'
import { markPurchaseOrderSent } from '@auxx/lib/money'
import {
  allocateLandedCost,
  DEFAULT_MATCH_TOLERANCE,
  findVendorPartForLine,
  matchBill,
} from '@auxx/lib/purchasing'
import {
  adjustStock,
  getLastReceiptCost,
  getPartReceiptHistory,
  listReceipts,
  openStockBalance,
  receivePurchaseOrder,
  receiveStock,
  reverseMovement,
  roundMinorUnits,
} from '@auxx/lib/receiving'
import { z } from 'zod'
import { capabilityProcedure, createTRPCRouter } from '~/server/api/trpc'

/** Money is stored in integer minor units (cents) everywhere in this subsystem. */
const minorUnits = z.number().int()

/** A movement quantity is a `doublePrecision` column, so fractions are legal; zero is not. */
const receiptQuantity = z.number().finite().positive()

const allocationBasis = z.enum(['value', 'quantity', 'weight'])

/**
 * One line of a purchase-order receipt: which line arrived, and how many.
 *
 * No price, deliberately. The agreed price is already frozen on the
 * `purchase_order_line` and `receivePurchaseOrder` reads it there, so there is
 * nothing for a line to state about what the goods cost.
 */
const purchaseOrderLine = z.object({
  partId: z.string().min(1),
  purchaseOrderLineId: z.string().min(1),
  quantity: receiptQuantity,
  vendorPartId: z.string().min(1).optional(),
})

/**
 * A purchase order's stated freight, tax and discount, plus how to spread them.
 *
 * These are ORDER-level amounts and they no longer reach the receiving path —
 * see `receivePurchaseOrder` below. The only procedure that still takes them is
 * `previewLandedCost`, which is pure arithmetic over a set of lines a caller
 * hands it and writes nothing.
 */
const purchaseOrderHeader = {
  shipping: minorUnits.optional(),
  tax: minorUnits.optional(),
  discount: minorUnits.optional(),
  taxRecoverable: z.boolean().optional(),
  basis: allocationBasis.optional(),
}

/**
 * How much drift the three-way match forgives. Every term carries the shipped
 * default, so a caller may send a partial object and still get a complete
 * tolerance — but sending nothing at all leaves it `undefined` and lets
 * `matchBill` apply {@link DEFAULT_MATCH_TOLERANCE} itself, so there is exactly
 * one source for those numbers.
 */
const matchTolerance = z.object({
  pricePercent: z.number().finite().nonnegative().default(DEFAULT_MATCH_TOLERANCE.pricePercent),
  priceAbsolute: minorUnits.nonnegative().default(DEFAULT_MATCH_TOLERANCE.priceAbsolute),
  quantityExact: z.boolean().default(DEFAULT_MATCH_TOLERANCE.quantityExact),
  receiptGraceDays: z
    .number()
    .finite()
    .nonnegative()
    .default(DEFAULT_MATCH_TOLERANCE.receiptGraceDays),
})

/**
 * Resolve an entity definition id from the org cache, or refuse.
 *
 * A missing def is a 404 rather than a 403: the member is not being denied
 * anything, the organization simply has no such records yet (the purchasing
 * entity migrations have not run for it).
 */
async function requireDefId(organizationId: string, entityType: string): Promise<string> {
  const defId = await getCachedEntityDefId(organizationId, entityType)
  if (!defId) {
    throw new NotFoundError(`This organization has no ${entityType} records yet.`)
  }
  return defId
}

/**
 * Purchasing and receiving surface: the receipt write path, the receipt reads,
 * and the two pure previews the receive dialog and the bill form run before
 * anything is committed.
 *
 * **Every procedure here is the permission gate for the lib call underneath it.**
 * `@auxx/lib/receiving` contains no access checks by design — both its module
 * headers say so explicitly — so if a gate is missing here it is missing
 * everywhere. The authority is per-definition, resolved from the org cache and
 * asserted against the request's `CapabilitySet`:
 *
 * | procedure                          | gate                                  |
 * | ---------------------------------- | ------------------------------------- |
 * | `markPurchaseOrderSent`            | edit on `purchase_order`              |
 * | `receiveStock`, `receivePurchaseOrder`, `adjustStock`, `reverseMovement` | edit on `stock_movement` |
 * | `listReceipts`, `partReceiptHistory`, `lastReceiptCost` | view on `stock_movement` |
 * | `previewLandedCost`                | edit on `stock_movement`              |
 * | `previewMatch`                     | edit on `vendor_bill`                 |
 *
 * `assertEditEntity` (not the coarser `assertWriteEntity`) is deliberate: it is
 * the server mirror of the `canEditEntity(stockMovementDefId)` the part drawer's
 * inventory tab already runs, so the button the UI hides and the door the server
 * closes are the same door. A second authority disagreeing with the record path
 * is the defect this avoids.
 *
 * Lib returns neverthrow `Result`s carrying `AuxxError`s; those are rethrown
 * as-is so `auxxErrorMiddleware` maps them to the right status. Wrapping one in
 * a `TRPCError` would flatten every 404/422 into a 500.
 */
export const purchasingRouter = createTRPCRouter({
  /**
   * Send a draft purchase order to its vendor — the writer `purchase_order_status`
   * never had.
   *
   * `issued` IS "sent to the vendor": one event, and the accounting word is the
   * better one, so there is no separate `sent` value. That is also why this is a
   * procedure rather than a dropdown write — once a Send exists, `issued` stops
   * being a value somebody picks, and the `rejectManualLifecycleStatus` system
   * pre-hook refuses the manual write that would otherwise claim an order went out
   * that never did (plans/purchasing/07-purchase-order-send-and-status.md §3.4).
   *
   * Gated on EDIT of `purchase_order`, not of `stock_movement`: this writes the
   * order, and nothing about a receipt.
   *
   * `markPurchaseOrderSent` throws its `AuxxError` directly rather than returning a
   * `Result` — it is a `@auxx/lib/money` lifecycle mutation and follows that
   * module's convention, not `@auxx/lib/receiving`'s. `auxxErrorMiddleware` maps it,
   * so there is nothing to unwrap here.
   */
  markPurchaseOrderSent: capabilityProcedure
    .input(z.object({ purchaseOrderId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const purchaseOrderDefId = await requireDefId(organizationId, 'purchase_order')
      ctx.capabilities.assertEditEntity(purchaseOrderDefId)

      await markPurchaseOrderSent({
        organizationId,
        userId,
        purchaseOrderInstanceId: input.purchaseOrderId,
      })
    }),

  /**
   * Receive one line against a bare part: this many arrived, at this price.
   *
   * The no-purchase-order door. There is no agreed price anywhere in the system
   * for a receipt with no `purchase_order_line`, so `vendorUnitPrice` is the one
   * number the browser is entitled to state — and it states the BASE price off
   * the packing slip, not the cost. The server reads the `vendor_part` row for
   * the freight, tariff and other adders and derives the landed cost itself.
   *
   * 🛑 **There is no `unitCost` on this input, and there must never be one.**
   * The cost frozen onto a movement is a fact the server holds; a client that
   * could assert it could value inventory at any number it liked, and because
   * every field on `stock_movement` is `updatable: false` the wrong figure would
   * be frozen forever with nothing thrown. Dropping it from this schema is what
   * makes that a fact rather than a convention
   * (plans/purchasing/05-receiving-cost-and-corrections.md section 4.1).
   */
  receiveStock: capabilityProcedure
    .input(
      z.object({
        partId: z.string().min(1),
        quantity: receiptQuantity,
        vendorPartId: z.string().min(1).optional(),
        /**
         * The BASE supplier price per unit, before the landed adders.
         *
         * Frozen on the movement as provenance for the three-way match as well,
         * which is why it is one field and not two: the number the vendor
         * invoiced is the number the landed cost is built on.
         */
        vendorUnitPrice: minorUnits.optional(),
        /** The ACCOUNTING date, which is not `createdAt`. Defaults to now. */
        occurredAt: z.coerce.date().optional(),
        reference: z.string().max(255).optional(),
        reason: z.string().max(2000).optional(),
        purchaseOrderLineId: z.string().min(1).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const movementDefId = await requireDefId(organizationId, 'stock_movement')
      ctx.capabilities.assertEditEntity(movementDefId)

      const result = await receiveStock(ctx.db, organizationId, userId, input)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Receive a multi-line purchase order: which lines arrived, and how many of
   * each.
   *
   * Every line must name a `purchase_order_line`, which is both the link the
   * roll-up and the three-way match need and — since the price left the wire —
   * the only way the server can find out what the line cost. `receivePurchaseOrder`
   * reads `purchase_order_line_expected_unit_price` per line and freezes that as
   * the movement's cost; a price on the wire would be ignored, so there is none.
   *
   * 🛑 **Nothing is allocated here.** The header freight, tax and discount used
   * to be spread across whatever was on this receipt. They are ORDER-level
   * amounts and a receipt is a SHIPMENT-level event, so allocating them at every
   * delivery capitalised the same freight once per delivery — $120.00 into
   * inventory against a $40.00 freight charge on PO-0001. The double-count
   * disappears by construction now that nothing allocates here; landed cost moves
   * to the bill, which is the document that actually states what the freight was
   * (plans/purchasing/05-receiving-cost-and-corrections.md sections 3.2 and 4.2).
   */
  receivePurchaseOrder: capabilityProcedure
    .input(
      z.object({
        lines: z.array(purchaseOrderLine).min(1).max(200),
        occurredAt: z.coerce.date().optional(),
        reference: z.string().max(255).optional(),
        reason: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const movementDefId = await requireDefId(organizationId, 'stock_movement')
      ctx.capabilities.assertEditEntity(movementDefId)

      const result = await receivePurchaseOrder(ctx.db, organizationId, userId, input)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Correct a part's on-hand count by a signed delta.
   *
   * The THIRD movement door, and until now the only one that wrote a
   * `stock_movement` through the generic `record.create` — which meant it
   * bypassed the zero-cost guard entirely and could add stock valued at nothing
   * (plans/purchasing/05-receiving-cost-and-corrections.md section 1.5).
   *
   * 🛑 **The browser states NO cost.** It used to send a `unitCost` on a positive
   * delta, on the argument that an adjustment has no supplier row and the person
   * keying the count is the only authority. Decision `G12` rejects that: an
   * adjustment is valued at the part's own frozen `part_standard_cost`, read by
   * the server, in BOTH directions — a typed number made the ledger's valuation
   * depend on who was counting, and a removal that carried no cost at all was
   * invisible to every period total that sums the ledger. A part with no
   * standard cost is refused by `adjustStock`, naming the part.
   */
  adjustStock: capabilityProcedure
    .input(
      z.object({
        partId: z.string().min(1),
        /** The signed delta. Positive adds stock, negative removes it; zero is refused. */
        quantity: z.number().finite(),
        /** The ACCOUNTING date, which is not `createdAt`. Defaults to now. */
        occurredAt: z.coerce.date().optional(),
        reason: z.string().max(2000).optional(),
        reference: z.string().max(255).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const movementDefId = await requireDefId(organizationId, 'stock_movement')
      ctx.capabilities.assertEditEntity(movementDefId)

      const result = await adjustStock(ctx.db, organizationId, userId, input)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * A part's opening balance: quantity and cost, once.
   *
   * plans/money/tasks/15-costing-usability.md §2.2. Writes one `initial`
   * movement and sets the part's FIRST `part_standard_cost` from the typed
   * `unitCost`, so the two agree by construction and the opening balance
   * carries no variance.
   *
   * 🛑 A typed unit cost here does NOT reopen `G12`. That decision removed
   * `adjustStock`'s cost input because an adjustment has no supplier row, no
   * purchase order and no packing slip, so there is no *actual* to record. An
   * opening balance is the one case where there is one, which is why `initial`
   * is its own movement type. `adjustStock` still takes no cost.
   *
   * Gated on edit for `stock_movement` — the same door `receiveStock`,
   * `adjustStock` and `reverseMovement` go through, because this writes the
   * ledger. It also writes `part_standard_cost`, but a person who may move
   * stock may set the opening cost of stock they are moving.
   */
  openStockBalance: capabilityProcedure
    .input(
      z.object({
        partId: z.string().min(1),
        /** Units on hand at the opening date. Strictly positive. */
        quantity: z.number().finite().positive(),
        /** What a unit cost, whole minor units. Strictly positive. */
        unitCost: z.number().int().positive(),
        /** The ACCOUNTING date, which is not `createdAt`. Defaults to now. */
        occurredAt: z.coerce.date().optional(),
        notes: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const movementDefId = await requireDefId(organizationId, 'stock_movement')
      ctx.capabilities.assertEditEntity(movementDefId)

      const result = await openStockBalance(ctx.db, organizationId, userId, input)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Undo a movement by writing its negation — the correction path that did not exist.
   *
   * Not an edit and not a delete. Every field on `stock_movement` is
   * `updatable: false` on purpose, because a cost frozen onto a movement can only
   * be trusted years later if nothing can rewrite it, so a correction is a second
   * row that cancels the first (section 5.1).
   *
   * 🛑 **The reversal carries the ORIGINAL's frozen `unitCost`, never today's
   * price.** Re-pricing a correction is the costing bug this whole subsystem
   * exists to avoid. It also copies the original's `purchaseOrderLine`, which is
   * what lets `quantity_received` roll back on its own — the roll-up re-SUMs every
   * movement pointing at the line and has no opinion about sign.
   *
   * A movement carrying no cost cannot be reversed: the negation would be the
   * zero-cost row `receiveStock` refuses to write in the first place.
   */
  reverseMovement: capabilityProcedure
    .input(
      z.object({
        movementId: z.string().min(1),
        /** Why it is being undone. Stamped on the reversing row, not the original. */
        reason: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const movementDefId = await requireDefId(organizationId, 'stock_movement')
      ctx.capabilities.assertEditEntity(movementDefId)

      const result = await reverseMovement(ctx.db, organizationId, userId, input)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * The one `vendor_part` row for a `(part, supplier)` pair — the PO line price prefill.
   *
   * Unambiguous by construction: `vendor_part_part` and `vendor_part_contact` are legs
   * 1 and 2 of an enforced natural key, so this resolves to at most one row and needs no
   * ambiguity handling.
   *
   * 🛑 `null` means this supplier has no catalogue entry for this part. That is NOT an
   * error and must NEVER fall back to the preferred vendor: `is_preferred` answers
   * "replacement cost for the part regardless of supplier", and using it here would put
   * a different supplier's price on this supplier's order.
   *
   * What comes back is a PREFILL. The price is frozen onto the line at order time and
   * nothing re-reads it through the link afterwards — `vendor_part_unit_price` is
   * mutable, `expected_unit_price` is the agreed number (section 5.2).
   */
  vendorPartForLine: capabilityProcedure
    .input(
      z.object({
        partInstanceId: z.string().min(1),
        vendorInstanceId: z.string().min(1),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const vendorPartDefId = await requireDefId(organizationId, 'vendor_part')
      ctx.capabilities.assertViewEntity(vendorPartDefId)

      const result = await findVendorPartForLine(ctx.db, organizationId, input)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /** Receipts across the org, newest accounting date first, paginated in SQL. */
  listReceipts: capabilityProcedure
    .input(
      z
        .object({
          partInstanceId: z.string().min(1).optional(),
          vendorPartId: z.string().min(1).optional(),
          since: z.coerce.date().optional(),
          until: z.coerce.date().optional(),
          limit: z.number().int().min(1).max(200).optional(),
          offset: z.number().int().min(0).optional(),
        })
        .default({})
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const movementDefId = await requireDefId(organizationId, 'stock_movement')
      ctx.capabilities.assertViewEntity(movementDefId)

      const result = await listReceipts(ctx.db, organizationId, input)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /** Every receipt for one part, newest accounting date first. */
  partReceiptHistory: capabilityProcedure
    .input(
      z.object({
        partInstanceId: z.string().min(1),
        since: z.coerce.date().optional(),
        until: z.coerce.date().optional(),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const movementDefId = await requireDefId(organizationId, 'stock_movement')
      ctx.capabilities.assertViewEntity(movementDefId)

      const { partInstanceId, ...filters } = input
      const result = await getPartReceiptHistory(ctx.db, organizationId, partInstanceId, filters)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * The unit cost frozen on the most recent PRICED receipt of a part.
   *
   * `null` means "no receipt of this part has ever carried a cost" and must be
   * treated as absence, never as zero — a receipt is never written at zero cost.
   */
  lastReceiptCost: capabilityProcedure
    .input(z.object({ partInstanceId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const movementDefId = await requireDefId(organizationId, 'stock_movement')
      ctx.capabilities.assertViewEntity(movementDefId)

      const result = await getLastReceiptCost(ctx.db, organizationId, input.partInstanceId)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Landed cost per line for a purchase order that has NOT been committed yet.
   *
   * Pure arithmetic — nothing is read or written. It takes the same line shape as
   * `receivePurchaseOrder` and derives each line total with the same
   * `roundMinorUnits` helper that path uses, so the number previewed here is the
   * number that gets frozen on the movements. Gated on the receive write rather
   * than on a read, because this only ever renders inside the receive dialog.
   */
  previewLandedCost: capabilityProcedure
    .input(
      z.object({
        lines: z
          .array(
            z.object({
              quantity: receiptQuantity,
              unitPrice: minorUnits,
              weight: z.number().finite().nonnegative().optional(),
            })
          )
          .min(1)
          .max(200),
        ...purchaseOrderHeader,
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const movementDefId = await requireDefId(organizationId, 'stock_movement')
      ctx.capabilities.assertEditEntity(movementDefId)

      const unitCosts = allocateLandedCost(
        input.lines.map((line) => ({
          lineTotal: roundMinorUnits(line.unitPrice * line.quantity),
          quantity: line.quantity,
          weight: line.weight,
        })),
        {
          shipping: input.shipping ?? 0,
          tax: input.tax ?? 0,
          discount: input.discount ?? 0,
          taxRecoverable: input.taxRecoverable ?? false,
        },
        input.basis ?? 'value'
      )
      return { unitCosts }
    }),

  /**
   * Three-way match verdict for a bill that has NOT been saved yet.
   *
   * Pure arithmetic — nothing is read or written. Gated on the `vendor_bill`
   * write, because this only ever renders inside the bill form.
   */
  previewMatch: capabilityProcedure
    .input(
      z.object({
        lines: z
          .array(
            z.object({
              quantityBilled: z.number().finite().nonnegative(),
              quantityReceived: z.number().finite().nonnegative(),
              unitPriceBilled: minorUnits,
              unitPriceExpected: minorUnits,
              /**
               * The purchase order HEADER's expected arrival, which is what ages
               * an `awaiting_receipt` line into a `receipt_overdue` exception
               * (P24). Absent means the order carries no expected date and the
               * line stays awaiting — see `isReceiptOverdue`.
               */
              expectedAt: z.coerce.date().nullish(),
            })
          )
          .max(500),
        tolerance: matchTolerance.optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const billDefId = await requireDefId(organizationId, 'vendor_bill')
      ctx.capabilities.assertEditEntity(billDefId)

      // `match.ts` reads no clock so that its aging rule is testable to
      // exhaustion; the impure edges supply "now". This is one of two (the other
      // is `rematchBill`).
      return matchBill(input.lines, new Date(), input.tolerance)
    }),
})
