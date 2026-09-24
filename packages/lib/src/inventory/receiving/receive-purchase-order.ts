// packages/lib/src/inventory/receiving/receive-purchase-order.ts

/**
 * The multi-line receipt: receive several purchase-order lines at once, each
 * valued at the price the purchase order already froze
 * (plans/purchasing/05-receiving-cost-and-corrections.md sections 3.2 and 4.1).
 *
 * This exists as its own entry point rather than as an option on
 * {@link import('./receive-stock').receiveStock} because the price authority is
 * different: this door has a `purchase_order_line` per line and reads
 * `purchase_order_line_expected_unit_price` from it, while the single-line door
 * receives against a bare part and has to be handed a price. The single-line
 * signature stays exactly as it is.
 *
 * 🛑 **Nothing is allocated here any more.** A purchase order's shipping, tax
 * and discount are ORDER-level amounts; a receipt is a SHIPMENT-level event.
 * Spreading the first across the second capitalises the same freight once per
 * delivery — on PO-0001 that put $120.00 into inventory against a $40.00 freight
 * charge across four receipts. The double-count disappears by construction once
 * nothing allocates at receipt. `allocateLandedCost` is kept, unchanged and
 * untouched, for the bill side (section 4.2), where the freight is actually
 * known.
 *
 * 🛑 **One receipt posts ONE `inventory_movement` entry, not one per line**
 * (TARGET §5 - "one entry per document with member links to its
 * `stock_movement`s"). Every line's movement is written in the same
 * transaction and the posting claims the FIRST movement as its subject, with
 * every movement — that one included — linked as a member, exactly the shape
 * `receiveStock`'s own single-movement posting already has, just with N
 * members instead of 1. Its `parent` is the purchase order every line belongs
 * to (TARGET §5's "document / order or PO"), resolved once for the whole set.
 *
 * No permission checks. The router asserts (build plan section 3.3).
 */

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { Result } from 'neverthrow'
import type { InTxPostResult } from '../../accounting/ledger/post/post-entry'
import {
  exportInventoryMovement,
  inventoryTxnDate,
  postInventoryMovementInTx,
} from '../../accounting/ledger/post/post-inventory-movement'
import { requireCachedEntityDefId } from '../../cache'
import { BadRequestError, NotFoundError, UnprocessableEntityError } from '../../errors'
import {
  PURCHASE_ORDER_LINE_ROLLUPS,
  recalculatePurchaseOrderLineRollups,
} from '../../field-hooks/post/purchase-order-line-rollups'
import { PURCHASE_ORDER_LINE_FIELDS } from '../../resources/registry/resources/purchase-order-line-fields'
import { pickSystemAttributes } from '../../resources/registry/system-attributes'
import {
  readSystemRecords,
  type SystemRecord,
  systemDefId,
  systemFields,
} from '../../resources/system-records'
import { readPartKinds } from '../builds/build-queries'
import { isServicePartKind } from '../costing/client'
import { batchRecalculateQoH } from '../costing/qoh'
import { readStandardCost } from '../costing/standard-cost-queries'
import { type StockMovementInput, writeStockMovements } from '../movements'
import { resolveInventoryRoleForPartKind } from '../movements/client'
import { assertCostFieldsMaterialized } from '../movements/cost-fields'
import type { MovementRecord } from '../movements/types'
import { computeReceiptAccrual, landedUnitEstimate, type ReceiptAccrualTerms } from './accruals'
import { guard } from './guard'
import { readPartKind, readVendorPartCostInputs } from './receipt-queries'
import { setFirstStandardCostFromReceipt } from './receive-stock'
import type { ReceivePurchaseOrderInput, ReceivePurchaseOrderLineInput } from './types'

const logger = createScopedLogger('receiving:receive-purchase-order')

/** The agreed price this door values a receipt at, and the order it credits the posting to. */
const PO_LINE_PICK = pickSystemAttributes(PURCHASE_ORDER_LINE_FIELDS, [
  'purchase_order_line_expected_unit_price',
  'purchase_order_line_purchase_order',
] as const)

type PoLineAttribute = (typeof PO_LINE_PICK)[number]

/**
 * Receive a purchase order, valuing every line at the part's frozen STANDARD
 * (73 §6.2 rule 1) and accruing the landed components the standard already
 * contains to the parties that will bill for them (§7.2).
 *
 * Each line becomes one `receive` movement with its `purchaseOrderLine` set —
 * which is what lets `quantityReceived` roll up from the ledger instead of being
 * typed, and what gives the three-way match something to compare the vendor's
 * bill against.
 *
 * 🛑 **The price is read here, not received here.** Any price on the wire is
 * ignored; the AGREED price is
 * `purchase_order_line_expected_unit_price`, read server-side from the line
 * being received against, and it is what `grni` is credited at and what the
 * match compares. The PO's agreed price previously reached the ledger by
 * round-tripping through an editable text box, so a browser could value stock at
 * any number it asserted — receipt 3 on PO-0001 is stored at $200.00 against an
 * agreed $12.50, and the three-way match cannot see it because the match reads
 * the bill against the PO line and never reads the movement's price at all.
 *
 * The `vendor_part` row is deliberately NOT a fallback. It holds standing terms
 * that may be months newer than the order; the whole reason
 * `expected_unit_price` exists is that the agreed price is frozen at order time.
 * A line without one is a data problem to fix on the order, not a price to guess.
 *
 * Validation runs over the whole set BEFORE the first movement is written — the
 * price read included. A partial write here is worse than a rejection: half a
 * shipment received is a PO that reads `partially_received` for a reason nobody
 * can reconstruct, and there is no undo for a ledger entry — only a compensating
 * one.
 *
 * Every movement is written in ONE transaction and the receipt posts ONE
 * `inventory_movement` entry against all of them (TARGET §5) — never `receiveStock`
 * per line, which would open its own transaction and post its own entry per line.
 */
export async function receivePurchaseOrder(
  db: Database,
  organizationId: string,
  userId: string,
  input: ReceivePurchaseOrderInput
): Promise<Result<MovementRecord[], Error>> {
  return guard(
    async () => {
      assertReceivableLines(input.lines ?? [])
      // A service order line is never received (107-D10): dropped, so the goods beside it still land.
      const lines = await withoutServiceLines(db, organizationId, input.lines ?? [])
      if (lines.length === 0) {
        throw new BadRequestError('Nothing on this receipt is stocked: a service is never received')
      }

      const poLines = await readPurchaseOrderLines(db, organizationId, lines)
      const unitCosts = lines.map((line, index) =>
        assertAgreedUnitPrice(
          poLines.get(line.purchaseOrderLineId)?.number('purchase_order_line_expected_unit_price'),
          line,
          index
        )
      )

      const occurredAt = input.occurredAt ?? new Date()

      // 73 §7.2: the standard is LANDED, so the receipt accrues freight and duty
      // to the parties that will bill for them. The adders come off the supplier
      // row the buyer chose on the order line, resolved at the receipt's own
      // date; the BASE stays the order's agreed price, because D2's bill debits
      // `grni` at that figure and the accrual has to close against it.
      const terms: ReceiptAccrualTerms[] = await Promise.all(
        lines.map(async (line, index) => {
          const agreedUnitPrice = unitCosts[index]!
          if (!line.vendorPartId) return { agreedUnitPrice }
          const read = await readVendorPartCostInputs(
            db,
            organizationId,
            line.vendorPartId,
            occurredAt
          )
          if (read.isErr() || !read.value) return { agreedUnitPrice }
          return {
            agreedUnitPrice,
            shippingCost: read.value.shippingCost,
            tariffRate: read.value.tariffRate,
            otherCost: read.value.otherCost,
          }
        })
      )
      const landedEstimates = terms.map((line) => landedUnitEstimate(line))

      const partDefId = await requireCachedEntityDefId(organizationId, 'part')
      const movementDefId = await systemDefId(db, organizationId, 'stock_movement')
      if (!movementDefId) {
        throw new NotFoundError('This organization has no stock_movement entity definition')
      }
      await assertCostFieldsMaterialized(organizationId)

      // One inventory role per line, from that line's OWN part kind — the same
      // read `receiveStock` makes per line, just run once for the whole set
      // ahead of the shared transaction rather than once per its own.
      const glAccounts = await Promise.all(
        lines.map(async (line) =>
          resolveInventoryRoleForPartKind(
            await unwrap(readPartKind(db, organizationId, line.partId))
          )
        )
      )

      // The posting's `parent` — the ONE purchase order every line belongs to
      // (TARGET §5: "document / order or PO"). `null` when the relation isn't
      // materialised; a receipt against more than one order is refused, since
      // the posting has exactly one parent slot to put it in.
      const purchaseOrderId = resolvePurchaseOrderId(poLines)

      // A part's FIRST receipt gives it a standard cost (`receiveStock`'s step
      // 4). Sequential, in line order: `ensureStandardCost` only writes where
      // one is missing, so two lines of the same part must run in the order the
      // caller sent them, exactly as the per-line delegation this replaces did.
      for (let i = 0; i < lines.length; i++) {
        await setFirstStandardCostFromReceipt(
          db,
          organizationId,
          lines[i]!.partId,
          landedEstimates[i]!,
          userId
        )
      }

      // 73 §6.2 rule 1: the movement is valued at the STANDARD, read after the
      // step above so a part whose provisional guess was just replaced is
      // received at what replaced it. The landed estimate is the fallback for a
      // part with no readable standard — the pre-73 valuation, and a `ppv` of
      // zero, rather than a receipt nobody can post.
      const standards = await readStandardCost(
        db,
        organizationId,
        lines.map((line) => line.partId)
      )
      const unitValues = lines.map(
        (line, index) =>
          (standards.isOk() ? standards.value.get(line.partId)?.standardCost : null) ??
          landedEstimates[index]!
      )
      const accruals = lines.map((line, index) =>
        computeReceiptAccrual(terms[index]!, line.quantity)
      )

      // The movements and the ONE entry that raises them, together — a
      // multi-line receipt is one document, not N (TARGET §5).
      const { written, post } = await db.transaction(async (tx) => {
        const txDb = tx as unknown as Database
        const movementInputs: StockMovementInput[] = lines.map((line, i) => ({
          partInstanceId: line.partId,
          type: 'receive',
          quantity: line.quantity,
          unitCost: unitValues[i]!,
          // 73 §6.2 rule 1. A receipt freezes the STANDARD: every consume and
          // every relief leaves at standard, so a receipt at the agreed price
          // left the difference sitting in the inventory account with no
          // quantity behind it, forever.
          costBasis: 'standard',
          glAccount: glAccounts[i]!,
          occurredAt,
          // The agreed price, unchanged: it is what the three-way match compares
          // the vendor's bill against, and what `grni` is credited at.
          vendorUnitPrice: unitCosts[i]!,
          accrued: {
            freightMinor: accruals[i]!.freightMinor,
            dutiesMinor: accruals[i]!.dutiesMinor,
            tariffRate: terms[i]!.tariffRate ?? undefined,
          },
          reference: input.reference,
          reason: input.reason,
          links: { vendorPartId: line.vendorPartId, purchaseOrderLineId: line.purchaseOrderLineId },
        }))

        const result = await writeStockMovements(
          { db: txDb, organizationId, userId, movementDefId, partDefId, lane: { kind: 'plain' } },
          movementInputs
        )
        if (result.isErr()) throw result.error
        const records = result.value.records

        const post: InTxPostResult | null = await postInventoryMovementInTx(tx, {
          organizationId,
          kind: 'receive',
          // The FIRST movement anchors the claim; every movement — itself
          // included — is linked as a `member` below, the same shape
          // `receiveStock`'s own single-movement posting already has.
          subject: { sourceKind: 'stock_movement', sourceId: records[0]!.movementId },
          ...(purchaseOrderId
            ? { parents: [{ sourceKind: 'purchase_order', sourceId: purchaseOrderId }] }
            : {}),
          txnDate: inventoryTxnDate(occurredAt),
          movements: records
            // `records` is in `lines` order, so the accrual pairs by index —
            // filtered together, or a dropped row would take its accrual's
            // credit legs with it and leave the entry plugging the gap to `ppv`.
            .map((record, i) => ({ record, accrual: accruals[i]! }))
            // A $0-standard row still credits its accruals; the whole price lands in `ppv`.
            .filter(
              ({ record, accrual }) =>
                record.glAccount &&
                (record.extendedCost !== 0 ||
                  accrual.grniMinor + accrual.freightMinor + accrual.dutiesMinor !== 0)
            )
            .map(({ record, accrual }) => ({
              id: record.movementId,
              extendedCostMinor: record.extendedCost,
              glAccountRole: record.glAccount as string,
              accrual,
            })),
          actorUserId: userId,
        })

        return { written: records, post }
      })

      // Belt on the plain lane's own recalculation, which fired against a
      // pre-commit snapshot from inside the transaction above. Swallowed for
      // `settleLineRollups`' reason: the movements are committed, and the
      // per-movement hook recalculates the same parts behind us.
      try {
        await batchRecalculateQoH(organizationId, [
          ...new Set(written.map((r) => r.partInstanceId)),
        ])
      } catch (error) {
        logger.error('Quantity on hand was not recalculated after a receipt', {
          organizationId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
      await exportInventoryMovement(db, post)

      await settleLineRollups(
        organizationId,
        lines.map((line) => line.purchaseOrderLineId)
      )

      return written.map((record, i) => {
        const line = lines[i]!
        return {
          movementId: record.movementId,
          recordId: record.recordId,
          partInstanceId: record.partInstanceId,
          quantity: record.quantity,
          unitCost: record.unitCost,
          extendedCost: record.extendedCost,
          vendorUnitPrice: unitCosts[i]!,
          vendorPartId: line.vendorPartId ?? null,
          glAccount: record.glAccount,
          occurredAt,
          purchaseOrderLineId: line.purchaseOrderLineId,
        } satisfies MovementRecord
      })
    },
    'Failed to receive purchase order',
    { organizationId, lineCount: input.lines?.length ?? 0 }
  )
}

async function withoutServiceLines(
  db: Database,
  organizationId: string,
  lines: readonly ReceivePurchaseOrderLineInput[]
): Promise<ReceivePurchaseOrderLineInput[]> {
  const kinds = await readPartKinds(
    db,
    organizationId,
    lines.map((line) => line.partId)
  )
  return lines.filter((line) => !isServicePartKind(kinds.get(line.partId)))
}

/** Unwrap a neverthrow `Result` back into the imperative style `guard()` expects. */
async function unwrap<T>(promise: Promise<Result<T, Error>>): Promise<T> {
  const result = await promise
  if (result.isErr()) throw result.error
  return result.value
}

/**
 * Roll the whole receipt up ONCE, now that every movement is committed.
 *
 * 🛑 The 10x. `stock_movement` create fires a lifecycle rule PER ROW, and that
 * rule re-SUMs one line and then derives the whole purchase order from it. A
 * ten-line receipt therefore ran the order-level pass ten times over the same
 * order — the same parent lookup, the same line set, the same answer nine times
 * out of ten. This call knows the entire line set before the first movement was
 * written, so it does the work once: one grouped SUM, one write per line that
 * actually moved, one order-level derivation.
 *
 * ⚠️ **It suppresses nothing, and that is the design.** The per-movement rules
 * still fire behind it. They find each line's `quantity_received` already equal
 * to the SUM they compute and return before writing, so the order-level pass
 * behind them never runs. The saving comes from getting there FIRST, not from a
 * flag — there is no context to thread, nothing to leak across the queue
 * boundary those rules actually run on, and if this call never happens the old
 * per-movement path produces exactly the same result, just more slowly.
 *
 * ⚠️ A failure here is logged and swallowed. The movements are the primary fact
 * and are already committed; throwing would report a receipt that happened as a
 * receipt that failed. The lifecycle rules are the fallback and still run.
 */
async function settleLineRollups(
  organizationId: string,
  purchaseOrderLineIds: string[]
): Promise<void> {
  try {
    await recalculatePurchaseOrderLineRollups(
      organizationId,
      purchaseOrderLineIds,
      PURCHASE_ORDER_LINE_ROLLUPS.received
    )
  } catch (error) {
    logger.error('Failed to settle purchase order line roll-ups after a receipt', {
      organizationId,
      lineCount: purchaseOrderLineIds.length,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Every line must name a part and a purchase-order line, and carry a positive
 * quantity.
 *
 * The `purchaseOrderLineId` requirement is what separates this from
 * {@link import('./receive-stock').receiveStock}: it is both the link the
 * roll-up and the three-way match need, and — since section 4.1 — the only way
 * this door can find out what the line cost.
 */
function assertReceivableLines(lines: ReceivePurchaseOrderLineInput[]): void {
  if (lines.length === 0) {
    throw new BadRequestError('A purchase order receipt needs at least one line')
  }
  for (const [index, line] of lines.entries()) {
    if (!line.partId) {
      throw new BadRequestError(`Line ${index + 1} has no part`)
    }
    if (!line.purchaseOrderLineId) {
      throw new BadRequestError(`Line ${index + 1} has no purchase order line`)
    }
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      throw new BadRequestError(`Line ${index + 1} must receive a quantity greater than zero`)
    }
  }
}

/**
 * Every purchase-order line being received, with the two cells this door reads.
 *
 * One read for the whole set rather than one per line: a fifty-line container
 * receipt would otherwise open fifty round trips before writing anything, and
 * the read has to complete for the entire set before the first movement anyway
 * (see the write path's validation contract).
 *
 * A line with no stored price is simply present with an absent cell, and
 * {@link assertAgreedUnitPrice} turns that into the refusal — this function
 * reports what is there, it does not judge it.
 *
 * `includeArchived`: a receipt against a line somebody archived after ordering
 * is still valued at the price that line froze.
 */
async function readPurchaseOrderLines(
  db: Database,
  organizationId: string,
  lines: ReceivePurchaseOrderLineInput[]
): Promise<Map<string, SystemRecord<PoLineAttribute>>> {
  const ctx = await systemFields(db, organizationId, 'purchase_order_line', PO_LINE_PICK)
  if (!ctx?.fields.purchase_order_line_expected_unit_price) {
    // Same shape as the receipt cost fields: "purchasing is not set up" beats
    // silently receiving a shipment nobody can value.
    throw new UnprocessableEntityError(
      'Receiving is not available until purchase order lines and their price field are provisioned'
    )
  }

  const records = await readSystemRecords(db, organizationId, ctx, {
    ids: lines.map((line) => line.purchaseOrderLineId),
    includeArchived: true,
  })
  return new Map(records.map((record) => [record.id, record]))
}

/**
 * The ONE purchase order every line in this receipt belongs to.
 *
 * `null` when the relation isn't materialised for this org — the posting then
 * carries no `parent`, the same as it carried none before this existed. A
 * receipt naming lines from more than one order is refused:
 * `postInventoryMovementInTx`'s `parent` is a single link, and picking one of
 * two orders to credit would be a silent, wrong answer rather than a missing
 * one. In practice this never fires — `receive-po-lines.ts` only ever builds a
 * receipt from one order's own lines — but the assertion is what makes that a
 * guarantee instead of an assumption.
 */
function resolvePurchaseOrderId(
  poLines: ReadonlyMap<string, SystemRecord<PoLineAttribute>>
): string | null {
  const orderIds = new Set<string>()
  for (const record of poLines.values()) {
    const orderId = record.related('purchase_order_line_purchase_order')
    if (orderId) orderIds.add(orderId)
  }
  if (orderIds.size === 0) return null
  if (orderIds.size > 1) {
    throw new BadRequestError(
      'A purchase order receipt can only be written against one purchase order, but these lines belong to more than one.'
    )
  }
  return [...orderIds][0]!
}

/**
 * The stored price, or a refusal naming the line it is missing from.
 *
 * Zero is refused here rather than left to `receiveStock`'s zero-cost guard so
 * the message names the purchase order line: "line 3 has no agreed price" is
 * actionable on the order, while "refusing to write a receipt at zero cost" sends
 * the reader to a form that no longer has a price box.
 */
function assertAgreedUnitPrice(
  stored: number | null | undefined,
  line: ReceivePurchaseOrderLineInput,
  index: number
): number {
  if (stored == null || !Number.isFinite(stored) || stored <= 0) {
    throw new UnprocessableEntityError(
      `Line ${index + 1} (purchase order line ${line.purchaseOrderLineId}) has no agreed unit price. ` +
        'Set the price on the purchase order line before receiving it.'
    )
  }
  return stored
}
