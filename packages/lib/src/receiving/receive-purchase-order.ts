// packages/lib/src/receiving/receive-purchase-order.ts

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
 * No permission checks. The router asserts (build plan section 3.3).
 */

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray } from 'drizzle-orm'
import type { Result } from 'neverthrow'
import { getOrgCache } from '../cache'
import { BadRequestError, UnprocessableEntityError } from '../errors'
import {
  PURCHASE_ORDER_LINE_ROLLUPS,
  recalculatePurchaseOrderLineRollups,
} from '../field-hooks/post/purchase-order-line-rollups'
import { guard } from './guard'
import { receiveStock } from './receive-stock'
import type {
  MovementRecord,
  ReceivePurchaseOrderInput,
  ReceivePurchaseOrderLineInput,
} from './types'

const logger = createScopedLogger('receiving:receive-purchase-order')

/** The one field this door reads to price a receipt. */
const EXPECTED_UNIT_PRICE_ATTRIBUTE = 'purchase_order_line_expected_unit_price'

/**
 * Receive a purchase order, valuing every line at its agreed price.
 *
 * Each line becomes one `receive` movement with its `purchaseOrderLine` set —
 * which is what lets `quantityReceived` roll up from the ledger instead of being
 * typed, and what gives the three-way match something to compare the vendor's
 * bill against.
 *
 * 🛑 **The price is read here, not received here.** Any price on the wire is
 * ignored; the value frozen onto the movement is
 * `purchase_order_line_expected_unit_price`, read server-side from the line
 * being received against. The PO's agreed price previously reached the ledger by
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
 */
export async function receivePurchaseOrder(
  db: Database,
  organizationId: string,
  userId: string,
  input: ReceivePurchaseOrderInput
): Promise<Result<MovementRecord[], Error>> {
  return guard(
    async () => {
      const lines = input.lines ?? []
      assertReceivableLines(lines)

      const stored = await readExpectedUnitPrices(db, organizationId, lines)
      const unitCosts = lines.map((line, index) =>
        assertAgreedUnitPrice(stored.get(line.purchaseOrderLineId), line, index)
      )

      const occurredAt = input.occurredAt ?? new Date()
      const written: MovementRecord[] = []

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!
        const agreedUnitPrice = unitCosts[i]!
        const result = await receiveStock(db, organizationId, userId, {
          partId: line.partId,
          quantity: line.quantity,
          vendorPartId: line.vendorPartId,
          // The same number in both roles, and that is the point: with nothing
          // capitalised at receipt the landed cost IS the agreed price, and
          // `vendorUnitPrice` carries it as provenance for the three-way match.
          // Passing `unitCost` explicitly is what stops `receiveStock` from
          // applying the supplier row's adders on top of it — freight belongs to
          // the bill.
          vendorUnitPrice: agreedUnitPrice,
          unitCost: agreedUnitPrice,
          occurredAt,
          reference: input.reference,
          reason: input.reason,
          purchaseOrderLineId: line.purchaseOrderLineId,
        })
        // `receiveStock` re-validates and applies the zero-cost guard per line,
        // so a line priced at zero is refused here rather than stored.
        // Rethrowing keeps that failure inside this function's own `guard()` and
        // preserves the AuxxError's status.
        if (result.isErr()) throw result.error
        written.push(result.value)
      }

      await settleLineRollups(
        organizationId,
        lines.map((line) => line.purchaseOrderLineId)
      )

      return written
    },
    'Failed to receive purchase order',
    { organizationId, lineCount: input.lines?.length ?? 0 }
  )
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
 * The agreed unit price of every line being received, in ONE query.
 *
 * One statement for the whole set rather than one per line: a fifty-line
 * container receipt would otherwise open fifty round trips before writing
 * anything, and the read has to complete for the entire set before the first
 * movement anyway (see the write path's validation contract).
 *
 * Keyed by `purchase_order_line` instance id. A line with no stored value is
 * simply absent from the map, and {@link assertAgreedUnitPrice} turns that into
 * the refusal — this function reports what is there, it does not judge it.
 *
 * The `organizationId` predicate plus a `fieldId` that only exists on
 * `purchase_order_line` is the scope: a caller cannot read another org's prices,
 * and an id that is not a purchase order line matches nothing.
 */
async function readExpectedUnitPrices(
  db: Database,
  organizationId: string,
  lines: ReceivePurchaseOrderLineInput[]
): Promise<Map<string, number | null>> {
  const fields = await getOrgCache()
    .from(organizationId, 'customFields')
    .bySystemAttributes([EXPECTED_UNIT_PRICE_ATTRIBUTE])
  const priceField = fields[EXPECTED_UNIT_PRICE_ATTRIBUTE]
  if (!priceField) {
    // Same shape as the receipt cost fields: "purchasing is not set up" beats
    // silently receiving a shipment nobody can value.
    throw new UnprocessableEntityError(
      'Receiving is not available until the purchase order line price field is provisioned'
    )
  }

  const lineIds = [...new Set(lines.map((line) => line.purchaseOrderLineId))]
  const rows = await db
    .select({
      entityId: schema.FieldValue.entityId,
      valueNumber: schema.FieldValue.valueNumber,
    })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        inArray(schema.FieldValue.entityId, lineIds),
        eq(schema.FieldValue.fieldId, priceField.id)
      )
    )

  return new Map(rows.map((row) => [row.entityId, row.valueNumber]))
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
