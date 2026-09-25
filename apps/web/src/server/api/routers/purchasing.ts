// apps/web/src/server/api/routers/purchasing.ts

import { type Database, schema } from '@auxx/database'
import { instantForBookDay } from '@auxx/lib/accounting/ledger'
import {
  allocateLandedCost,
  checkIntakeModelCapability,
  clearLandedCost,
  commitIntakeDraft,
  createBillIntakeRun,
  createIntakeDraft,
  DEFAULT_MATCH_TOLERANCE,
  discardIntakeDraft,
  failBillIntakeRun,
  findVendorPartForLine,
  findVendorPartsForParts,
  foldBillLineIntoShipping,
  getBillIntakeRun,
  getBillIntakeRunForBill,
  getIntakeDraft,
  linkBillLines,
  markPurchaseOrderSent,
  matchBill,
  postVendorBill,
  previewVendorBill,
  proposeBillLineLinks,
  readLandedCostByBill,
  readLandedCostByVendorPart,
  resumeBillIntakeRun,
  updateBillIntakeRun,
  updateIntakeDraftPayload,
  voidVendorBill,
} from '@auxx/lib/accounting/purchasing'
import { INTAKE_TIERS } from '@auxx/lib/accounting/purchasing/intake/client'
import { getCachedEntityDefId, getOrgCache } from '@auxx/lib/cache'
import { NotFoundError, UnprocessableEntityError } from '@auxx/lib/errors'
import { computeExtendedCost, reverseMovement } from '@auxx/lib/inventory/movements'
import {
  adjustStock,
  bulkOpenStockBalance,
  bulkSetPartKind,
  getLastReceiptCost,
  getPartReceiptHistory,
  listOpeningStockCandidates,
  listReceipts,
  openStockBalance,
  readSetCountPreflight,
  receivePurchaseOrder,
  receiveStock,
} from '@auxx/lib/inventory/receiving'
import {
  adoptTariffStarters,
  applyTariffResync,
  applyTariffSchedule,
  expandTariffStarter,
  listHtsChildren,
  loadHtsGeneral,
  loadTariffActions,
  loadTariffMemberships,
  planTariffResync,
  TARIFF_STARTERS_VERSION,
} from '@auxx/lib/inventory/tariffs'
import { PermissionKey } from '@auxx/lib/permissions'
import { parseRecordId, type RecordId, recordIdSchema, toRecordId } from '@auxx/types/resource'
import { isAtPrecision, RATE_DECIMALS } from '@auxx/utils/currency'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { calendarDaySchema } from '~/server/api/calendar-day-schema'
import { capabilityProcedure, createTRPCRouter, permissionProcedure } from '~/server/api/trpc'
import { vendorCreditRouter } from './vendor-credit'

/** An AMOUNT - money owed, paid or booked - is an integer minor unit everywhere in this subsystem. */
const minorUnits = z.number().int()

/** Verify the definition, organization and live row before passing a picker value to a worker. */
async function requireBillIntakeRecord(
  db: Database,
  organizationId: string,
  recordId: RecordId,
  entityType:
    | 'company'
    | 'purchase_order'
    | 'vendor_bill'
    | 'vendor_bill_line'
    | 'purchase_order_line'
): Promise<RecordId> {
  const defId = await requireDefId(organizationId, entityType)
  const parsed = parseRecordId(recordId)
  if (parsed.entityDefinitionId !== defId && parsed.entityDefinitionId !== entityType) {
    throw new UnprocessableEntityError(`Expected a ${entityType.replaceAll('_', ' ')} record`)
  }
  const row = await db.query.EntityInstance.findFirst({
    where: and(
      eq(schema.EntityInstance.id, parsed.entityInstanceId),
      eq(schema.EntityInstance.entityDefinitionId, defId),
      eq(schema.EntityInstance.organizationId, organizationId),
      isNull(schema.EntityInstance.archivedAt)
    ),
    columns: { id: true },
  })
  if (!row) throw new NotFoundError('The selected record is no longer available')
  return toRecordId(defId, row.id)
}

/** A calendar day, the shape every accounting date crosses the wire in. */

/**
 * A RATE - money per one of something (`unitCost`, `vendorUnitPrice`, a line's
 * unit price) - kept to `RATE_DECIMALS` (five major-unit places) rather than
 * collapsed to a whole minor unit, so a fastener vendor's per-thousand price
 * ($15.94 / 1,000 = 1.594 minor units) is exact rather than rounded away.
 */
const rateMinorUnits = z
  .number()
  .finite()
  .positive()
  .refine((value) => isAtPrecision(value, RATE_DECIMALS), {
    message: 'must have at most five decimal places',
  })

/**
 * The intake form of {@link rateMinorUnits}: a TRANSCRIBED unit price, which may
 * be zero.
 *
 * 🛑 A quote prints 0.00 all the time - a free sample, a no-charge replacement,
 * an "included" freight line - and §3.1's rule is that we transcribe what is
 * printed and never correct it. `rateMinorUnits` refuses zero because it guards
 * a RECEIPT or an opening-balance cost, where zero is a missing number; here it
 * is the vendor's own number, and rejecting it fails the review screen's save
 * with nothing on screen to explain why.
 *
 * `expectedUnitPrice`, which this becomes on commit, is `nullable: true` with no
 * positivity constraint of its own, so the draft was stricter than the field it
 * writes to.
 *
 * Still non-negative: a discount printed as a negative line is folded into the
 * header or dropped (§5.4), never carried as a negative price into costing.
 */
const intakeRateMinorUnits = z
  .number()
  .finite()
  .nonnegative()
  .refine((value) => isAtPrecision(value, RATE_DECIMALS), {
    message: 'must have at most five decimal places',
  })

/**
 * The signed form of {@link rateMinorUnits}: a vendor-bill unit price may be
 * negative (a credit line is real - `match.ts`'s `assertPrice` allows it),
 * unlike a receipt or opening-balance cost, which must be a real positive price.
 */
const signedRateMinorUnits = z
  .number()
  .finite()
  .refine((value) => isAtPrecision(value, RATE_DECIMALS), {
    message: 'must have at most five decimal places',
  })

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

// ── Quote intake (plans/money/tasks/38-purchase-order-from-a-document.md) ────
//
// The draft payload round-trips through the browser: the worker writes it, the
// review screen edits it, `saveIntakeDraft` writes it back. These schemas are
// the wire's half of `IntakeDraftPayload` — the compile-time coupling is at the
// call site, where the parsed value is handed to a lib function that takes the
// interface, so a drift in either direction is a type error rather than a
// silently accepted blob in a jsonb column.
//
// 🛑 Every money field stays a STRING here, exactly as the vendor printed it.
// `parseIntakeMoney` is the one place a printed amount becomes minor units; a
// second parse on this boundary is how the review screen and the committed
// order come to disagree about a price.

const transcribedPriceBreak = z.object({
  minQuantity: z.number().finite(),
  unitPriceText: z.string().nullable(),
})

const transcribedLine = z.object({
  lineNumber: z.number().finite().nullable(),
  vendorCode: z.string().nullable(),
  description: z.string().nullable(),
  quantity: z.number().finite().nullable(),
  unit: z.string().nullable(),
  unitPriceText: z.string().nullable(),
  lineTotalText: z.string().nullable(),
  leadTime: z.string().nullable(),
  priceBreaks: z.array(transcribedPriceBreak).max(20),
})

const transcribedQuote = z.object({
  vendorName: z.string().nullable(),
  vendorEmail: z.string().nullable(),
  vendorPhone: z.string().nullable(),
  vendorAddress: z.string().nullable(),
  quoteNumber: z.string().nullable(),
  quoteDate: z.string().nullable(),
  validUntil: z.string().nullable(),
  currency: z.string().nullable(),
  subtotalText: z.string().nullable(),
  shippingText: z.string().nullable(),
  taxText: z.string().nullable(),
  totalText: z.string().nullable(),
  lines: z.array(transcribedLine).max(500),
})

const intakeCandidate = z.object({
  recordId: recordIdSchema,
  displayName: z.string(),
  secondary: z.string().nullable(),
})

const intakePartCandidate = intakeCandidate.extend({ tier: z.enum(INTAKE_TIERS) })

const intakeLine = z.object({
  lineId: z.string().min(1).max(64),
  printed: transcribedLine,
  tier: z.enum(INTAKE_TIERS),
  candidates: z.array(intakePartCandidate).max(20),
  partRecordId: recordIdSchema.nullable(),
  vendorPartRecordId: recordIdSchema.nullable(),
  description: z.string().nullable(),
  quantity: z.number().finite(),
  unitPriceCents: intakeRateMinorUnits.nullable(),
  chosenBreakIndex: z.number().int().nonnegative().nullable(),
  foldedInto: z.enum(['shipping', 'tax']).nullable(),
  // Defaulted, not required: a draft written before the field existed is still
  // under its 24-hour TTL, and its lines come back with no `removed` key.
  removed: z.boolean().default(false),
})

const intakeDraftPayload = z.object({
  transcription: transcribedQuote,
  vendorRecordId: recordIdSchema.nullable(),
  vendorCandidates: z.array(intakeCandidate).max(20),
  lines: z.array(intakeLine).max(500),
  currency: z.string().length(3),
  quoteNumber: z.string().nullable(),
  quoteDate: z.string().nullable(),
  expectedDeliveryDate: z.string().nullable(),
  shippingCents: minorUnits,
  taxCents: minorUnits,
})

/**
 * One accepted `vendorSku` write-back, offered per line and unchecked by
 * default (§5.3). A vendor's printed line code is sometimes their order number
 * rather than their part number, so writing it blind poisons every future
 * tier-1 match.
 */
const intakeWriteBack = z.object({
  partRecordId: recordIdSchema,
  vendorSku: z.string().min(1).max(255),
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
 * `@auxx/lib/inventory/receiving` contains no access checks by design — both its module
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
 * | `intakeModelCapability`, `startQuoteIntake`, `getIntakeDraft`, `saveIntakeDraft`, `discardIntakeDraft` | **view** on `purchase_order` |
 * | `commitIntakeDraft`                | edit on `purchase_order`              |
 * | `startBillIntake`                  | **edit** on `vendor_bill`; also view on `purchase_order` when an order is given |
 * | `resumeBillIntake`                 | edit on `vendor_bill`                 |
 * | `getBillIntakeRun`, `getBillIntakeRunForBill`, `proposeBillLineLinks` | view on `vendor_bill` |
 * | `linkBillLines`                    | edit on `vendor_bill`                 |
 *
 * 🛑 The quote-intake group gating on VIEW is deliberate, not an oversight. The
 * five read/draft procedures write an intake draft and nothing else - no
 * number, no list entry, self-collected in 24 hours — so create authority is not
 * what reading a supplier's PDF should cost. `commitIntakeDraft` is the moment
 * records appear, and it is the one that asks for edit
 * (plans/money/tasks/38-purchase-order-from-a-document.md §4.3, §6.3).
 *
 * 🛑 The bill-intake group inverts that call on purpose. `startBillIntake`
 * gates on EDIT of `vendor_bill`, not view, because a bill has no draft stage
 * to hide behind (plans/money/tasks/58-vendor-bill-from-the-invoice.md §1.3,
 * "the bill IS the draft"): the worker job it enqueues writes a real
 * `vendor_bill` the moment the read succeeds, with nothing left to commit
 * afterward. Create authority is exactly what starting that read should cost.
 * `resumeBillIntake` and `linkBillLines` are the same door for the same
 * reason - one resumes the path to a created bill, the other writes the
 * link a created bill's lines carry. The three read procedures stay on VIEW,
 * matching the quote group: a poll of the run or a proposed match writes
 * nothing.
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
  /** The supplier's credit note (71 §5 U7). */
  vendorCredit: vendorCreditRouter,

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
   * `Result` — it is a `@auxx/lib/accounting/purchasing` lifecycle mutation and follows that
   * module's convention, not `@auxx/lib/inventory/receiving`'s. `auxxErrorMiddleware` maps it,
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
   * Post an expense-coded vendor bill to the general ledger and mark it
   * `posted` - the standalone company's A/P
   * (plans/accounting/tasks/21-the-books-stand-alone.md §3.2).
   *
   * ```
   *   Dr <the account each line is coded to>   line total
   *       Cr accounts_payable                    bill total
   * ```
   *
   * The same door shape `creditMemo.issue` and `markInvoiceSent` use: the ledger
   * goes FIRST and a refused post refuses the transition, naming the reason, so
   * `posted` never claims a bill is in the books that is not.
   *
   * 🛑 `ledgerPost`, not the entity EDIT capability the receipts above assert.
   * This writes to the books; who may edit a bill and who may put money in the
   * general ledger are different questions, and `money.writeOffInvoice` and
   * `creditMemo.issue` already answer it this way.
   */
  postVendorBill: permissionProcedure(PermissionKey.ledgerPost)
    .input(
      z.object({
        vendorBillId: z.string().min(1),
        /** `YYYY-MM-DD`. Overrides the bill's own date for this post. */
        billedAt: calendarDaySchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return postVendorBill(ctx.db, {
        organizationId: ctx.session.organizationId,
        userId: ctx.session.userId,
        vendorBillInstanceId: input.vendorBillId,
        billedAt: input.billedAt,
      })
    }),

  /** What posting WOULD write. Persists nothing; `blockedBy` carries a refusal. */
  previewVendorBill: permissionProcedure(PermissionKey.ledgerView)
    .input(
      z.object({
        vendorBillId: z.string().min(1),
        billedAt: calendarDaySchema.optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      return previewVendorBill(ctx.db, {
        organizationId: ctx.session.organizationId,
        userId: ctx.session.userId,
        vendorBillInstanceId: input.vendorBillId,
        billedAt: input.billedAt,
      })
    }),

  /**
   * Void a bill: reverse its entry at `-R1`, then set `void`. A refused
   * reversal refuses the void, so a voided bill can never leave its expense and
   * its payable standing in the books.
   */
  voidVendorBill: permissionProcedure(PermissionKey.ledgerPost)
    .input(z.object({ vendorBillId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await voidVendorBill(ctx.db, {
        organizationId: ctx.session.organizationId,
        userId: ctx.session.userId,
        vendorBillInstanceId: input.vendorBillId,
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
        vendorUnitPrice: rateMinorUnits.optional(),
        /** The ACCOUNTING day, which is not `createdAt`. Defaults to today in the book zone. */
        day: calendarDaySchema.optional(),
        reference: z.string().max(255).optional(),
        reason: z.string().max(2000).optional(),
        purchaseOrderLineId: z.string().min(1).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const movementDefId = await requireDefId(organizationId, 'stock_movement')
      ctx.capabilities.assertEditEntity(movementDefId)

      const { day, ...rest } = input
      const occurredAt = day ? await instantForBookDay(organizationId, day) : undefined
      const result = await receiveStock(ctx.db, organizationId, userId, { ...rest, occurredAt })
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
        /** The ACCOUNTING day. Defaults to today in the book zone. */
        day: calendarDaySchema.optional(),
        reference: z.string().max(255).optional(),
        reason: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const movementDefId = await requireDefId(organizationId, 'stock_movement')
      ctx.capabilities.assertEditEntity(movementDefId)

      const { day, ...rest } = input
      const occurredAt = day ? await instantForBookDay(organizationId, day) : undefined
      const result = await receivePurchaseOrder(ctx.db, organizationId, userId, {
        ...rest,
        occurredAt,
      })
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
   * "I have N as of D" - the one count door (111 D21). A first count anchors an `initial`
   * at the ledger start; a further count writes an `adjust` for the difference. A typed unit
   * cost becomes the part's FIRST `part_standard_cost` (a typed $0 is real, 103 §5a).
   *
   * 🛑 A typed unit cost here does NOT reopen `G12`: `adjustStock` still takes no cost.
   *
   * Gated on edit for `stock_movement`, the same door `receiveStock`, `adjustStock` and
   * `reverseMovement` go through, because this writes the ledger.
   */
  setCount: capabilityProcedure
    .input(
      z.object({
        partId: z.string().min(1),
        /** Units on the shelf on the count day. Zero or more. */
        quantity: z.number().finite().nonnegative(),
        /** What a unit cost. A RATE - at most RATE_DECIMALS places, zero allowed. */
        unitCost: intakeRateMinorUnits.optional(),
        /** The count day, `YYYY-MM-DD` in the book time zone. Defaults to today there. */
        day: calendarDaySchema.optional(),
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

  /** What the Set count dialog shows before it writes: the anchor state and the backflush signal (111 Q25). */
  setCountPreflight: capabilityProcedure
    .input(z.object({ partIds: z.array(z.string().min(1)).min(1).max(500) }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      const movementDefId = await requireDefId(organizationId, 'stock_movement')
      ctx.capabilities.assertViewEntity(movementDefId)

      const result = await readSetCountPreflight(ctx.db, organizationId, input.partIds)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Every part in the org, with what the opening-stock checklist needs to decide
   * its row state and its `finished_good` suggestion.
   *
   * plans/money/tasks/52-parts-costing-page.md §5. One bulk read, never a loop:
   * the org this exists for has 495 parts, and asking the single-part door's
   * five questions of each of them is roughly 2,500 queries.
   *
   * 🛑 Read-gated on `stock_movement`, not on `part`, and deliberately the same
   * def the RUN writes. The answer is a preview of what `runOpeningStock` will
   * do; showing it to somebody the mutation then refuses is the affordance-that-
   * fails pattern the Costing page's gate exists to avoid.
   *
   * ⚠️ What comes back is a PREVIEW. `hasMovements` is re-read inside the run
   * itself, because a candidate list the browser has been holding for a minute
   * is not an authority on an append-only ledger.
   */
  listOpeningStockCandidates: capabilityProcedure.query(async ({ ctx }) => {
    const { organizationId } = ctx.session
    const movementDefId = await requireDefId(organizationId, 'stock_movement')
    ctx.capabilities.assertViewEntity(movementDefId)

    const result = await listOpeningStockCandidates(ctx.db, organizationId)
    if (result.isErr()) throw result.error
    return result.value
  }),

  /**
   * `setCount` for many parts at once, each on its own count day (103 O1, 111 D21).
   *
   * 🛑 **It never throws for a part.** An anchored part is EXCLUDED unless `adjustAnchored`
   * (the Set counts page, which shows the delta), an invalid entry FAILS, and the run returns
   * a summary naming both with the reason per part.
   *
   * Gated on edit for `stock_movement`, the same door `setCount` goes through.
   */
  runSetCounts: capabilityProcedure
    .input(
      z.object({
        /** `YYYY-MM-DD`, for every entry that names none of its own. Defaults to today. */
        day: calendarDaySchema.optional(),
        adjustAnchored: z.boolean().optional(),
        entries: z
          .array(
            z.object({
              partId: z.string().min(1),
              /** Units on the shelf on the count day. Zero or more. */
              quantity: z.number().finite().nonnegative(),
              /** What a unit cost. A RATE - at most RATE_DECIMALS places, zero allowed. */
              unitCost: intakeRateMinorUnits.optional(),
              day: calendarDaySchema.optional(),
            })
          )
          .min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const movementDefId = await requireDefId(organizationId, 'stock_movement')
      ctx.capabilities.assertEditEntity(movementDefId)

      const result = await bulkOpenStockBalance(ctx.db, organizationId, userId, input)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Set `part_kind` across a selection — the confirm that must precede the run.
   *
   * 🛑 **Gated on `part`, not on `stock_movement`.** The two definitions carry
   * their own per-def grants, and this writes a part field; borrowing the
   * ledger's gate would let somebody who may move stock reclassify parts they
   * have no rights to.
   *
   * ⚠️ The kind decides the inventory account, and the account is frozen onto an
   * `updatable: false` movement (§6.3) — which is why the confirm is a write of
   * a human's choice on the same screen as the run, and never a derivation.
   */
  bulkSetPartKind: capabilityProcedure
    .input(
      z.object({
        partIds: z.array(z.string().min(1)).min(1),
        /**
         * A `PartKind` value: `component`, `subassembly` or `finished_good`.
         *
         * Not narrowed to an enum here on purpose. `bulkSetPartKind` validates
         * against the registry's own `PartKind.values`, so the rule holds for
         * the worker and the seeder too, and a fourth kind becomes legal in one
         * place rather than two.
         *
         * ⚠️ `PartKind.values` is `FieldOptionItem[]` (objects with `value` /
         * `label` / `color`), not a string tuple, so `z.enum` cannot consume it
         * and hand-listing the three names here would be the second place this
         * comment exists to avoid.
         */
        kind: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      const partDefId = await requireDefId(organizationId, 'part')
      ctx.capabilities.assertEditEntity(partDefId)

      const result = await bulkSetPartKind(
        ctx.db,
        organizationId,
        userId,
        input.partIds,
        input.kind
      )
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

  /**
   * Which of these parts this supplier already has a `vendor_part` for.
   *
   * 🛑 The intake commit dialog asks this before offering §5.3's write-backs,
   * because the two outcomes are not the same act. A pair that already has a row
   * gets one field set on it; a pair that does not gets a **new catalogue entry
   * created** — a `vendor_part` that then takes part in price prefills,
   * preferred-vendor reads and part-cost recalculation. Offering both behind one
   * unlabelled checkbox hides the larger of the two.
   *
   * Read fresh at the moment of the decision rather than trusting the draft's
   * stored `vendorPartRecordId`: parts can be picked before a vendor is chosen,
   * and the vendor can be changed after the parts were picked, so the stored link
   * can name another supplier's row.
   */
  vendorPartsForParts: capabilityProcedure
    .input(
      z.object({
        vendorInstanceId: z.string().min(1),
        partInstanceIds: z.array(z.string().min(1)).max(500),
      })
    )
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      ctx.capabilities.assertViewEntity(await requireDefId(organizationId, 'vendor_part'))

      const result = await findVendorPartsForParts(ctx.db, organizationId, input)
      if (result.isErr()) throw result.error
      // A Map does not survive superjson's default transformers here, and the
      // caller only needs membership.
      return { existingPartInstanceIds: [...result.value.keys()] }
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
   * `computeExtendedCost` helper that path uses, so the number previewed here is
   * the number that gets frozen on the movements. Gated on the receive write
   * rather than on a read, because this only ever renders inside the receive
   * dialog.
   */
  previewLandedCost: capabilityProcedure
    .input(
      z.object({
        lines: z
          .array(
            z.object({
              quantity: receiptQuantity,
              unitPrice: rateMinorUnits,
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
          // `lineTotal` is an AMOUNT (`unitPrice x quantity`, whole minor
          // units) - never `roundMinorUnits`, which now rounds RATES.
          lineTotal: computeExtendedCost(line.unitPrice, line.quantity),
          quantity: line.quantity,
          weight: line.weight,
        })),
        {
          shipping: input.shipping ?? 0,
          tax: input.tax ?? 0,
          discount: input.discount ?? 0,
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
              unitPriceBilled: signedRateMinorUnits,
              unitPriceExpected: signedRateMinorUnits,
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

  /**
   * Reprice every part with a classified supplier offer at today's tariff
   * schedule (money 29 §8, §12 a).
   *
   * A future-dated rate row does not apply itself - nothing is written at
   * midnight and `recalculateAllPartCosts` has no scheduled caller - so the
   * schedule screen carries this as an explicit action, in keeping with the
   * rest of the subsystem, where nothing revalues without a person.
   *
   * Asserts `part` edit because `part_cost` on `part` rows is what it writes,
   * the same gate `builds.roll` uses. It touches no standard cost and no
   * movement: `part_cost` is the live replacement cost the same recalc rewrites
   * on every vendor-price change, and a stale one is the whole reason the
   * button exists.
   */
  applyTariffSchedule: capabilityProcedure.mutation(async ({ ctx }) => {
    const { organizationId } = ctx.session
    ctx.capabilities.assertEditEntity(await requireDefId(organizationId, 'part'))

    const result = await applyTariffSchedule(ctx.db, organizationId)
    if (result.isErr()) throw result.error
    return result.value
  }),

  /**
   * The starter catalogue, browsed as a tree for one origin (money 32 §1.4,
   * §10): a 4-digit heading, a 6-digit subheading, then the 10-digit lines
   * under it. There is no 8-digit level by decision - the general rate is set
   * at 8 digits in the source, but the lines below a subheading are few
   * enough (a single direct line under roughly two in five subheadings) that
   * an extra expand step mostly revealed one row, so the 8-digit row's own
   * text folds into the subheading node or the leaf's short description
   * instead of getting a tree level of its own.
   *
   * `parent: null` returns every heading; a heading code returns its
   * subheadings; a subheading code returns its lines, each expanded through
   * the same `expandTariffStarter` the adopt mutation writes with. A search
   * term prunes every level to what has a match beneath it and never
   * flattens the tree. Pure data, no db: the generated HTS file is lazily
   * loaded on first use.
   */
  listTariffStarterChildren: capabilityProcedure
    .input(
      z.object({
        country: z.string().length(2),
        parent: z.string().max(20).nullable(),
        /** Prunes the tree to matches at every level; never flattens it. */
        q: z.string().max(80).default(''),
      })
    )
    .query(async ({ input }) => {
      // Both loads memoise for the process; the second is free after the first
      // request that touches the catalogue.
      const [catalogue, memberships, actions] = await Promise.all([
        loadHtsGeneral(),
        loadTariffMemberships(),
        loadTariffActions(),
      ])
      const { nodes, leaves } = listHtsChildren(catalogue, input.parent, input.q)
      return {
        version: TARIFF_STARTERS_VERSION,
        nodes,
        leaves: leaves.map((line) =>
          expandTariffStarter(line, input.country, memberships, { actions })
        ),
      }
    }),

  /**
   * Create `tariff_code` records, each with its catalogue rate rows, for the
   * pairs named (money 32 §2).
   *
   * Asserts edit on BOTH defs - the same gate `record.create` applies to each
   * and the one the tariffs page already redirects on (29 §12 d). Not
   * `settingsManage`: a tariff code is reference data, not a control surface.
   * Everything else - skip pairs the org holds, refuse unknown codes, write a
   * pair whole or not at all - is the lib function's contract.
   */
  adoptTariffStarters: capabilityProcedure
    .input(
      z.object({
        entries: z
          .array(z.object({ code: z.string().min(4).max(20), country: z.string().length(2) }))
          .min(1)
          .max(200),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      ctx.capabilities.assertEditEntity(await requireDefId(organizationId, 'tariff_code'))
      ctx.capabilities.assertEditEntity(await requireDefId(organizationId, 'tariff_rate'))

      const result = await adoptTariffStarters(ctx.db, organizationId, userId, input)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * What the catalogue would ADD to the codes this org already holds, grouped
   * by the government action that would add it (money 35 §6).
   *
   * ONE query for the whole page, not one per row: the tariffs page already
   * loads every code and every rate, and a per-row query would be N round trips
   * to render a badge. The per-row button (§7.2) filters this same answer
   * client-side rather than asking again.
   *
   * A read, so `assertViewEntity` on both defs - the plan resolves the schedule
   * to say what a code would go from and to, which is reading rate rows.
   */
  planTariffResync: capabilityProcedure.query(async ({ ctx }) => {
    const { organizationId } = ctx.session
    ctx.capabilities.assertViewEntity(await requireDefId(organizationId, 'tariff_code'))
    ctx.capabilities.assertViewEntity(await requireDefId(organizationId, 'tariff_rate'))

    const result = await planTariffResync(ctx.db, organizationId)
    if (result.isErr()) throw result.error
    return result.value
  }),

  /**
   * Append one government action's missing rows to the codes named (money 35
   * §6).
   *
   * Asserts edit on BOTH defs - the same gate `adoptTariffStarters` uses, for
   * the same reason: a tariff code is reference data, not a control surface, so
   * this is not `settingsManage`.
   *
   * 🛑 The posted `codeInstanceIds` are a NARROWING, never a plan. The lib
   * function re-derives the diff from the live schedule inside the call, so a
   * stale browser plan cannot write a row that is already there. Everything
   * else - insert only, one transaction per code, a partial run reported rather
   * than thrown - is the lib function's contract.
   */
  applyTariffResync: capabilityProcedure
    .input(
      z.object({
        actionKey: z.string().min(1).max(64),
        codeInstanceIds: z.array(z.string().min(1)).min(1).max(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      ctx.capabilities.assertEditEntity(await requireDefId(organizationId, 'tariff_code'))
      ctx.capabilities.assertEditEntity(await requireDefId(organizationId, 'tariff_rate'))

      const result = await applyTariffResync(ctx.db, organizationId, userId, input)
      if (result.isErr()) throw result.error
      return result.value
    }),
  /**
   * Can this organization's default model read an uploaded document at all?
   *
   * The upload dialog asks before it offers a file picker, because a model with
   * no file input refuses AFTER the upload otherwise — the same sentence, spent
   * at the least useful moment. Fails OPEN inside
   * `resolveCapabilityGates`: an unknown model is allowed to try.
   *
   * A read, so it gates on VIEW of `purchase_order`.
   */
  // `.optional()` so both `useQuery()` and `useQuery({})` typecheck on the
  // client — the procedure takes nothing either way.
  intakeModelCapability: capabilityProcedure
    .input(z.object({}).optional())
    .query(async ({ ctx }) => {
      const { organizationId } = ctx.session
      ctx.capabilities.assertViewEntity(await requireDefId(organizationId, 'purchase_order'))

      const result = await checkIntakeModelCapability(organizationId)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Take an uploaded quote and start reading it (§3.3).
   *
   * Two steps and no third: create the draft row, enqueue the job. The read is
   * 10 to 40 seconds of model time on a three-page quote, far past a
   * comfortable mutation, so what comes back is the `draftId` the dialog then
   * polls. The row exists before the enqueue on purpose — the job's stable
   * `jobId` is built from it, and a message pointing at a row that is not there
   * yet is a race with nothing to gain.
   *
   * 🛑 Gated on VIEW, not create. This writes an intake draft and
   * nothing else; a draft is not a purchase order, has no number, appears in no
   * list, and self-collects in 24 hours (§4.3 / §6.3). Requiring create here
   * would mean a member who may not raise orders cannot even read a quote for
   * somebody who can — and `commitIntakeDraft`, the one procedure that creates
   * records, is where the create authority actually belongs.
   */
  startQuoteIntake: capabilityProcedure
    .input(
      z.object({
        /** `asset:<mediaAssetId>` — the temp upload the custom-field door left. */
        assetRef: z.string().min(1).max(255),
        fileName: z.string().max(500).nullish(),
        mimeType: z.string().max(255).nullish(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      ctx.capabilities.assertViewEntity(await requireDefId(organizationId, 'purchase_order'))

      const draft = await createIntakeDraft(organizationId, userId, input)
      if (draft.isErr()) throw draft.error

      const { enqueuePurchaseIntake } = await import('@auxx/lib/jobs')
      await enqueuePurchaseIntake({ organizationId, userId, draftId: draft.value.draftId })

      return draft.value
    }),

  /**
   * The draft as the dialog and the review screen read it.
   *
   * Polled while `status` is `reading` — `phase` is what turns a 40-second wait
   * into a checklist rather than a spinner.
   */
  getIntakeDraft: capabilityProcedure
    .input(z.object({ draftId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      ctx.capabilities.assertViewEntity(await requireDefId(organizationId, 'purchase_order'))

      const result = await getIntakeDraft(organizationId, input.draftId)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Write the review screen's edits back onto the draft.
   *
   * The whole payload, not a patch: the review screen holds it as one object
   * and a per-field mutation would need a merge rule for a blob nothing else
   * reads. Nothing here creates a record (§6.1).
   *
   * 🛑 VIEW again, for the same reason as `startQuoteIntake`: picking a part on
   * a draft row writes no `purchase_order` and no `purchase_order_line`.
   */
  saveIntakeDraft: capabilityProcedure
    .input(z.object({ draftId: z.string().min(1), payload: intakeDraftPayload }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      ctx.capabilities.assertViewEntity(await requireDefId(organizationId, 'purchase_order'))

      const result = await updateIntakeDraftPayload(organizationId, input.draftId, input.payload)
      if (result.isErr()) throw result.error
      return { ok: true as const }
    }),

  /**
   * Abandon a draft. Leaves no records behind, because there were never any
   * (§6.1) — the temp upload it points at expires on its own 24-hour fuse.
   */
  discardIntakeDraft: capabilityProcedure
    .input(z.object({ draftId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      ctx.capabilities.assertViewEntity(await requireDefId(organizationId, 'purchase_order'))

      const result = await discardIntakeDraft(organizationId, input.draftId)
      if (result.isErr()) throw result.error
    }),

  /**
   * Turn a reviewed draft into a real purchase order (§6.3).
   *
   * 🛑 The ONE procedure in this group that gates on EDIT, and the only one that
   * writes records. It goes through the generic create path so the RecordSequence
   * hook mints the number, links the quote into `purchase_order.attachments`
   * (INTERNAL by default, so the vendor's own quote never rides back to that
   * vendor on our order), and performs the accepted `vendorSku` write-backs.
   *
   * The hard gate — every orderable line must carry a part — lives in
   * `commitIntakeDraft`, not here: `purchase_order_line.part` is leg 2 of the
   * natural key and `required: true` (§0), so a partless line is rejected at
   * create anyway. Refusing in lib means the browser's disabled button and the
   * server's door are the same rule, checked once.
   */
  commitIntakeDraft: capabilityProcedure
    .input(
      z.object({
        draftId: z.string().min(1),
        writeBacks: z.array(intakeWriteBack).max(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      ctx.capabilities.assertEditEntity(await requireDefId(organizationId, 'purchase_order'))

      const result = await commitIntakeDraft(ctx.db, organizationId, userId, input)
      if (result.isErr()) throw result.error
      return result.value
    }),

  // ── Bill intake (plans/money/tasks/58-vendor-bill-from-the-invoice.md) ──────
  //
  // A vendor's invoice in, a draft `vendor_bill` out, its lines linked to the
  // order's lines where the paper says so. Unlike the quote group above, there
  // is no Redis draft standing between the read and the record: the bill IS
  // the draft (§1.3), so the group's one create-shaped procedure gates on EDIT
  // rather than VIEW - see the header comment's second 🛑 for the reasoning.

  /**
   * Take an uploaded invoice and start reading it (§4.1, §4.6).
   *
   * Two steps, the same shape `startQuoteIntake` uses: open the run, enqueue
   * the job. The run exists before the enqueue so the job's stable id points
   * at something real rather than racing it.
   *
   * 🛑 Gated on EDIT of `vendor_bill`, not view like the quote's start. The
   * quote writes a Redis draft that becomes a `purchase_order` only at
   * `commitIntakeDraft`; a bill has no such second step (§1.3, "the bill IS
   * the draft") - the worker job this enqueues writes a real `vendor_bill`
   * the moment the read succeeds. Create authority is exactly what starting
   * that read should cost.
   *
   * Also asserts VIEW on `purchase_order` when `purchaseOrderRecordId` is
   * given: the run reads that order's own lines to match the invoice against,
   * so starting a read that leans on an order requires seeing it.
   */
  startBillIntake: capabilityProcedure
    .input(
      z.object({
        /** `asset:<mediaAssetId>` - the temp upload the custom-field door left. */
        assetRef: z.string().min(1).max(255),
        fileName: z.string().max(500).nullish(),
        mimeType: z.string().max(255).nullish(),
        /** From the `choose` page's vendor picker, when the person set one. */
        vendorRecordId: recordIdSchema.nullish(),
        /** From the `choose` page's picker, or from an order's Bills card. */
        purchaseOrderRecordId: recordIdSchema.nullish(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      ctx.capabilities.assertEditEntity(await requireDefId(organizationId, 'vendor_bill'))
      let vendorRecordId = input.vendorRecordId
        ? await requireBillIntakeRecord(ctx.db, organizationId, input.vendorRecordId, 'company')
        : null
      let purchaseOrderRecordId: RecordId | null = null
      if (input.purchaseOrderRecordId) {
        ctx.capabilities.assertViewEntity(await requireDefId(organizationId, 'purchase_order'))
        purchaseOrderRecordId = await requireBillIntakeRecord(
          ctx.db,
          organizationId,
          input.purchaseOrderRecordId,
          'purchase_order'
        )
        const vendorField = await getOrgCache()
          .from(organizationId, 'customFields')
          .bySystemAttribute('purchase_order_vendor')
        const orderVendor = vendorField
          ? await ctx.db.query.FieldValue.findFirst({
              where: and(
                eq(schema.FieldValue.organizationId, organizationId),
                eq(
                  schema.FieldValue.entityId,
                  parseRecordId(purchaseOrderRecordId).entityInstanceId
                ),
                eq(schema.FieldValue.fieldId, vendorField.id)
              ),
              columns: { relatedEntityId: true },
            })
          : null
        if (!orderVendor?.relatedEntityId) {
          throw new UnprocessableEntityError('Choose a purchase order with a vendor')
        }
        if (
          vendorRecordId &&
          parseRecordId(vendorRecordId).entityInstanceId !== orderVendor.relatedEntityId
        ) {
          throw new UnprocessableEntityError('The vendor must match the purchase order')
        }
        vendorRecordId = await requireBillIntakeRecord(
          ctx.db,
          organizationId,
          toRecordId(await requireDefId(organizationId, 'company'), orderVendor.relatedEntityId),
          'company'
        )
      }

      const run = await createBillIntakeRun(organizationId, userId, {
        ...input,
        vendorRecordId,
        purchaseOrderRecordId,
      })
      if (run.isErr()) throw run.error

      const { enqueueBillIntake } = await import('@auxx/lib/jobs')
      try {
        await enqueueBillIntake({ organizationId, userId, runId: run.value.runId })
      } catch (error) {
        await failBillIntakeRun(
          organizationId,
          run.value.runId,
          'The invoice could not be queued. Please try again.'
        )
        throw error
      }

      return run.value
    }),

  /**
   * Answer a run parked in `needs_vendor` with a person's pick, and let the
   * job carry on from where it stopped (§4.1 step 2, §4.2, §5.1).
   *
   * Gated on EDIT of `vendor_bill`, the same door `startBillIntake` uses:
   * this is still the path that ends in a created bill, only resumed rather
   * than started. `resumeBillIntakeRun` itself refuses
   * (`UnprocessableEntityError`) a run that is not actually `needs_vendor`,
   * so a stale tab cannot redirect a `reading` or `failed` run onto a vendor
   * nobody chose for it.
   */
  resumeBillIntake: capabilityProcedure
    .input(z.object({ runId: z.string().min(1), vendorRecordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      ctx.capabilities.assertEditEntity(await requireDefId(organizationId, 'vendor_bill'))

      const vendorRecordId = await requireBillIntakeRecord(
        ctx.db,
        organizationId,
        input.vendorRecordId,
        'company'
      )
      const resumed = await resumeBillIntakeRun(organizationId, input.runId, vendorRecordId)
      if (resumed.isErr()) throw resumed.error

      const { enqueueBillIntake } = await import('@auxx/lib/jobs')
      try {
        await enqueueBillIntake({ organizationId, userId, runId: input.runId, resume: true })
      } catch (error) {
        // Keep Continue usable if the queue is unavailable after saving the pick.
        const restored = await updateBillIntakeRun(organizationId, input.runId, {
          status: 'needs_vendor',
        })
        if (restored.isErr()) throw restored.error
        throw error
      }

      return { ok: true as const }
    }),

  /**
   * The run as the reading page polls it (§5.1): phases ticking, the vendor
   * picker on `needs_vendor`, the created bill's id on success.
   *
   * VIEW on `vendor_bill`: a read of the run, nothing written.
   */
  getBillIntakeRun: capabilityProcedure
    .input(z.object({ runId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      ctx.capabilities.assertViewEntity(await requireDefId(organizationId, 'vendor_bill'))

      const result = await getBillIntakeRun(organizationId, input.runId)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * The run behind a bill, if one still exists (§4.3). A bill older than the
   * run's 24 hour TTL simply has no run, and `null` is not an error - the
   * page's read banner just has nothing to show.
   *
   * VIEW on `vendor_bill`, same as `getBillIntakeRun`.
   */
  getBillIntakeRunForBill: capabilityProcedure
    .input(z.object({ billRecordId: recordIdSchema }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      ctx.capabilities.assertViewEntity(await requireDefId(organizationId, 'vendor_bill'))

      await requireBillIntakeRecord(ctx.db, organizationId, input.billRecordId, 'vendor_bill')
      const { entityInstanceId } = parseRecordId(input.billRecordId)
      const result = await getBillIntakeRunForBill(organizationId, entityInstanceId)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * The matcher run against a stored bill's own lines (§3.5, §6.5): the
   * "Match lines" action on the link card, and the only door a manually
   * entered bill or an expired intake run ever gets to the matcher through.
   *
   * Reads only, so VIEW on `vendor_bill` is enough.
   */
  proposeBillLineLinks: capabilityProcedure
    .input(z.object({ billRecordId: recordIdSchema }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      ctx.capabilities.assertViewEntity(await requireDefId(organizationId, 'vendor_bill'))

      await requireBillIntakeRecord(ctx.db, organizationId, input.billRecordId, 'vendor_bill')
      const result = await proposeBillLineLinks(ctx.db, organizationId, input.billRecordId)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Write the accepted links from the "Match lines" card (§6.5): one update
   * per line, through `linkBillLineToOrderLine`, the one writer a manual
   * link and a read's own create step both go through.
   *
   * 🛑 Gated on EDIT of `vendor_bill`, alongside `startBillIntake` and
   * `resumeBillIntake` as the group's mutations. `linkBillLines` itself
   * verifies every `lineRecordId` belongs to `billRecordId` and every
   * `orderLineRecordId` belongs to that bill's own order before writing
   * anything, so one bad row in a batch cannot cross-link two unrelated
   * records.
   */
  linkBillLines: capabilityProcedure
    .input(
      z.object({
        billRecordId: recordIdSchema,
        links: z
          .array(z.object({ lineRecordId: recordIdSchema, orderLineRecordId: recordIdSchema }))
          .min(1)
          .max(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      ctx.capabilities.assertEditEntity(await requireDefId(organizationId, 'vendor_bill'))

      await requireBillIntakeRecord(ctx.db, organizationId, input.billRecordId, 'vendor_bill')
      const [billLineDefId, orderLineDefId] = await Promise.all([
        requireDefId(organizationId, 'vendor_bill_line'),
        requireDefId(organizationId, 'purchase_order_line'),
      ])
      for (const link of input.links) {
        if (
          ![billLineDefId, 'vendor_bill_line'].includes(
            parseRecordId(link.lineRecordId).entityDefinitionId
          ) ||
          ![orderLineDefId, 'purchase_order_line'].includes(
            parseRecordId(link.orderLineRecordId).entityDefinitionId
          )
        )
          throw new UnprocessableEntityError('Choose bill lines and purchase order lines')
      }
      const result = await linkBillLines(ctx.db, organizationId, userId, input)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * One goods bill's landed cost (73 §7.2): what its receipts accrued for
   * freight and duty, what other vendors' bills have charged against it through
   * `vendor_bill_line_landed_bill`, and the difference.
   *
   * Reads only and posts nothing — the accrual balance is the control until the
   * landed-cost voucher (follow-up item 11) lands.
   */
  readLandedCostByBill: capabilityProcedure
    .input(z.object({ vendorBillInstanceId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      ctx.capabilities.assertViewEntity(await requireDefId(organizationId, 'vendor_bill'))
      ctx.capabilities.assertViewEntity(await requireDefId(organizationId, 'stock_movement'))

      const result = await readLandedCostByBill(ctx.db, organizationId, input.vendorBillInstanceId)
      if (result.isErr()) throw result.error
      return result.value
    }),

  /** The same read per vendor part, its share of each shipment derived by value x rate. */
  readLandedCostByVendorPart: capabilityProcedure
    .input(z.object({ vendorPartInstanceId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const { organizationId } = ctx.session
      ctx.capabilities.assertViewEntity(await requireDefId(organizationId, 'vendor_part'))
      ctx.capabilities.assertViewEntity(await requireDefId(organizationId, 'stock_movement'))

      const result = await readLandedCostByVendorPart(
        ctx.db,
        organizationId,
        input.vendorPartInstanceId
      )
      if (result.isErr()) throw result.error
      return result.value
    }),

  /**
   * Clear what a shipment still has accrued for freight and duty, as
   * `Dr <accrual> / Cr ppv` (74 D4). Refuses when nothing is left accrued.
   */
  clearLandedCost: capabilityProcedure
    .input(z.object({ vendorBillInstanceId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      ctx.capabilities.assertEditEntity(await requireDefId(organizationId, 'vendor_bill'))

      const result = await clearLandedCost(ctx.db, {
        organizationId,
        goodsBillInstanceId: input.vendorBillInstanceId,
        actorUserId: userId,
      })
      if (result.isErr()) throw result.error
      return result.value
    }),

  /** Move a confirmed, unlinked line's printed total into shipping without changing other totals. */
  foldBillLineIntoShipping: capabilityProcedure
    .input(z.object({ billRecordId: recordIdSchema, lineRecordId: recordIdSchema }))
    .mutation(async ({ ctx, input }) => {
      const { organizationId, userId } = ctx.session
      ctx.capabilities.assertEditEntity(await requireDefId(organizationId, 'vendor_bill'))
      ctx.capabilities.assertEditEntity(await requireDefId(organizationId, 'vendor_bill_line'))
      ctx.capabilities.assertDeleteEntity(await requireDefId(organizationId, 'vendor_bill_line'))
      const result = await foldBillLineIntoShipping(ctx.db, organizationId, userId, input)
      if (result.isErr()) throw result.error
      return result.value
    }),
})
