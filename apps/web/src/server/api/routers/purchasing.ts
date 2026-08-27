// apps/web/src/server/api/routers/purchasing.ts

import { getCachedEntityDefId } from '@auxx/lib/cache'
import { NotFoundError } from '@auxx/lib/errors'
import { allocateLandedCost, DEFAULT_MATCH_TOLERANCE, matchBill } from '@auxx/lib/purchasing'
import {
  getLastReceiptCost,
  getPartReceiptHistory,
  listReceipts,
  receivePurchaseOrder,
  receiveStock,
  roundMinorUnits,
} from '@auxx/lib/receiving'
import { z } from 'zod'
import { capabilityProcedure, createTRPCRouter } from '~/server/api/trpc'

/** Money is stored in integer minor units (cents) everywhere in this subsystem. */
const minorUnits = z.number().int()

/** A movement quantity is a `doublePrecision` column, so fractions are legal; zero is not. */
const receiptQuantity = z.number().finite().positive()

const allocationBasis = z.enum(['value', 'quantity', 'weight'])

const purchaseOrderLine = z.object({
  partId: z.string().min(1),
  purchaseOrderLineId: z.string().min(1),
  quantity: receiptQuantity,
  /** Agreed buy price per unit, BEFORE header freight/tax is spread onto it. */
  unitPrice: minorUnits,
  vendorPartId: z.string().min(1).optional(),
  /** Shipping weight for the whole line. Read only by the `weight` basis. */
  weight: z.number().finite().nonnegative().optional(),
})

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
 * | `receiveStock`, `receivePurchaseOrder` | edit on `stock_movement`          |
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
   * Receive one line: this many of this part arrived, at this price.
   *
   * `unitCost` supplied here WINS over anything derivable from the `vendor_part`
   * row — the vendor's actual invoice beats the standing terms. Leave it out to
   * let the supplier row price the receipt.
   */
  receiveStock: capabilityProcedure
    .input(
      z.object({
        partId: z.string().min(1),
        quantity: receiptQuantity,
        vendorPartId: z.string().min(1).optional(),
        /** Raw supplier price per unit, frozen as provenance for the three-way match. */
        vendorUnitPrice: minorUnits.optional(),
        /** Landed cost per unit. */
        unitCost: minorUnits.optional(),
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
   * Receive a multi-line purchase order, spreading the header freight/tax/discount
   * across the lines and freezing the resulting landed cost on each movement.
   *
   * Every line must name a `purchase_order_line`: a movement carrying a share of a
   * freight bill with no link back to the shipment cannot be audited later.
   */
  receivePurchaseOrder: capabilityProcedure
    .input(
      z.object({
        lines: z.array(purchaseOrderLine).min(1).max(200),
        ...purchaseOrderHeader,
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

      return matchBill(input.lines, input.tolerance)
    }),
})
