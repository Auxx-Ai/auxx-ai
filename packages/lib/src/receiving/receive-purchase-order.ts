// packages/lib/src/receiving/receive-purchase-order.ts

/**
 * The multi-line receipt: receive several purchase-order lines at once and
 * capitalise the header's freight, tax and discount into their unit costs
 * (plans/purchasing/01-build-plan.md sections 3.1 and 4.3).
 *
 * This exists as its own entry point rather than as an option on
 * {@link import('./receive-stock').receiveStock} because allocation is a
 * property of the SET of lines, not of any one of them: a line's landed cost
 * depends on what else was on the truck. Threading that through the single-line
 * signature would mean every caller passing the whole shipment to receive one
 * part of it. The single-line signature stays exactly as it is.
 *
 * No permission checks. The router asserts (build plan section 3.3).
 */

import type { Database } from '@auxx/database'
import type { Result } from 'neverthrow'
import { BadRequestError, UnprocessableEntityError } from '../errors'
import { allocateLandedCost } from '../purchasing'
import type { AllocationBasis } from '../purchasing/types'
import { roundMinorUnits } from './client'
import { guard } from './guard'
import { receiveStock } from './receive-stock'
import type {
  MovementRecord,
  ReceivePurchaseOrderInput,
  ReceivePurchaseOrderLineInput,
} from './types'

/**
 * Receive a purchase order, spreading the header totals across its lines.
 *
 * Each line becomes one `receive` movement with the ALLOCATED unit cost and its
 * `purchaseOrderLine` set — which is what lets `quantityReceived` roll up from
 * the ledger instead of being typed, and what gives the three-way match
 * something to compare the vendor's bill against.
 *
 * Validation runs over the whole set BEFORE the first movement is written. A
 * partial write here is worse than a rejection: half a shipment received is a
 * PO that reads `partially_received` for a reason nobody can reconstruct, and
 * there is no undo for a ledger entry — only a compensating one.
 *
 * ⚠️ The allocation itself is deliberately NOT implemented here. It lives in
 * `packages/lib/src/purchasing/` as a pure function so it can be tested to
 * exhaustion and so the PO form can preview a landed cost before anything is
 * committed. See that module for the residual-cent reconciliation rule.
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

      const basis: AllocationBasis = input.basis ?? 'value'
      const unitCosts = allocateLandedCost(
        lines.map((line) => ({
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
        basis
      )

      if (unitCosts.length !== lines.length) {
        throw new UnprocessableEntityError(
          'Landed cost allocation returned a different number of lines than were received'
        )
      }

      const occurredAt = input.occurredAt ?? new Date()
      const written: MovementRecord[] = []

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!
        const result = await receiveStock(db, organizationId, userId, {
          partId: line.partId,
          quantity: line.quantity,
          vendorPartId: line.vendorPartId,
          // The agreed buy price, frozen as provenance. The allocated cost below
          // is what the stock is VALUED at; this is what the vendor charged, and
          // the match compares the bill against this one.
          vendorUnitPrice: roundMinorUnits(line.unitPrice),
          unitCost: unitCosts[i]!,
          occurredAt,
          reference: input.reference,
          reason: input.reason,
          purchaseOrderLineId: line.purchaseOrderLineId,
        })
        // `receiveStock` re-validates and applies the zero-cost guard per line,
        // so an allocation that produced a zero or negative unit cost is refused
        // here rather than stored. Rethrowing keeps that failure inside this
        // function's own `guard()` and preserves the AuxxError's status.
        if (result.isErr()) throw result.error
        written.push(result.value)
      }

      return written
    },
    'Failed to receive purchase order',
    { organizationId, lineCount: input.lines?.length ?? 0 }
  )
}

/**
 * Every line must name a part and a purchase-order line, and carry a positive
 * quantity and a finite price.
 *
 * The `purchaseOrderLineId` requirement is what separates this from
 * {@link import('./receive-stock').receiveStock}: an allocated cost is only
 * defensible if the line it was allocated across can be pointed at. A movement
 * carrying a share of a freight bill with no link back to the shipment is a
 * number nobody can audit three years later.
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
    if (!Number.isFinite(line.unitPrice)) {
      throw new BadRequestError(`Line ${index + 1} has no unit price`)
    }
  }
}
