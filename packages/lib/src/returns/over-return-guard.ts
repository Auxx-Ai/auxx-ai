// packages/lib/src/returns/over-return-guard.ts

/**
 * Plan section 3.5's guard: **a sold line cannot have more come back than went
 * out**, summed across every `return_line` pointing at it, across every return.
 *
 * Several `return_line` rows may point at one `line_item` - the grain is one
 * row per sold line **per condition**, so two lifts back, one pristine and one
 * wrecked, is two rows of quantity 1. That is what makes a per-row check
 * useless and this cross-return sum necessary: without it a customer can
 * return three of two lifts, and the salvage tree would happily restock parts
 * for a unit that never shipped.
 *
 * 🛑 **The ceiling is an INPUT, not something this function derives.** Today it
 * is the line's **sold** quantity, which is the documented fallback. When task
 * 55 lands, `fulfillment_line` gives a per-dispatch **shipped** quantity and
 * the correct ceiling becomes the sum of that line's fulfillment-line
 * quantities, excluding dispatches whose status is cancelled - a line ordered
 * 5 and shipped 2 can have at most 2 come back, where the sold ceiling would
 * wave through 5. The caller swaps the number; nothing in this file changes,
 * and it stays testable without either table existing.
 *
 * ⚠️ Sold quantity remains the ceiling for any line with no fulfillment lines
 * at all - every line predating 55's re-sync, and every manually keyed return
 * with no order. The guard tightens where the data exists and never gets
 * looser than the old rule where it does not.
 */

import { err, ok, type Result } from 'neverthrow'
import { InvalidReturnQuantityError, OverReturnError } from './salvage-errors'

/** One existing `return_line`'s claim on a sold line. */
export interface ReturnedQuantityClaim {
  /** The `return_line` id, so an update can exclude its own prior row. */
  returnLineId: string
  quantity: number
}

/** Everything {@link checkOverReturn} needs. No database, no derivation. */
export interface OverReturnCheckInput {
  lineItemId: string
  /**
   * The most units that may ever come back against this line.
   *
   * Sold quantity today; the shipped quantity once task 55 lands. See the file
   * header - this function never computes it.
   */
  ceiling: number
  /**
   * Every `return_line` already pointing at this `line_item`, **across all
   * returns**, not just the one being edited.
   */
  existing: readonly ReturnedQuantityClaim[]
  /**
   * The row being written. `returnLineId` is set when this is an edit of an
   * existing row, and that row is then excluded from the sum - otherwise
   * saving a row of 2 unchanged would count its own 2 twice and refuse itself.
   */
  candidate: { returnLineId?: string | null; quantity: number }
}

/**
 * Units already claimed against the line, optionally ignoring one row.
 *
 * Exported because the create dialog wants the number to show, not just the
 * verdict.
 */
export function sumReturnedQuantity(
  existing: readonly ReturnedQuantityClaim[],
  excludeReturnLineId?: string | null
): number {
  let total = 0
  for (const claim of existing) {
    if (excludeReturnLineId && claim.returnLineId === excludeReturnLineId) continue
    total += claim.quantity
  }
  return total
}

/**
 * How many more units the line can still take back. Never negative, so a line
 * that is already over-returned reads as 0 rather than as credit.
 */
export function remainingReturnableQuantity(
  input: Omit<OverReturnCheckInput, 'candidate'> & {
    candidate?: { returnLineId?: string | null }
  }
): number {
  const already = sumReturnedQuantity(input.existing, input.candidate?.returnLineId)
  return Math.max(0, input.ceiling - already)
}

/**
 * Refuse a return line that would bring back more than the line let out.
 *
 * Belongs in a pre-write hook, not in the UI: several returns can point at one
 * sold line and no single screen sees them all.
 *
 * A non-positive or non-finite candidate quantity refuses separately. It would
 * otherwise pass every ceiling comparison and then restock parts for units
 * that never shipped, which is the exact failure the ceiling exists to
 * prevent, arriving through the door the ceiling does not watch.
 */
export function checkOverReturn(
  input: OverReturnCheckInput
): Result<void, OverReturnError | InvalidReturnQuantityError> {
  const requested = input.candidate.quantity
  if (!Number.isFinite(requested) || requested <= 0) {
    return err(new InvalidReturnQuantityError({ quantity: requested }))
  }

  const alreadyReturned = sumReturnedQuantity(input.existing, input.candidate.returnLineId)
  if (alreadyReturned + requested > input.ceiling) {
    return err(
      new OverReturnError({
        lineItemId: input.lineItemId,
        ceiling: input.ceiling,
        alreadyReturned,
        requested,
      })
    )
  }

  return ok(undefined)
}
