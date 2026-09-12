// packages/lib/src/returns/salvage-errors.ts

/**
 * The refusals the returns logic can produce, as `AuxxError` subclasses.
 *
 * Every one of them is a **typed refusal returned in a `neverthrow` `err()`**,
 * never thrown: the caller is a pre-write hook or the gated salvage writer
 * (plan section 6.3, step 7), both of which have to report which part or which
 * row was refused rather than fail the whole batch opaquely. Each class
 * therefore carries the identifying fields as real properties, because
 * `AuxxErrorDetails` only admits strings.
 *
 * All of them are 422s: they are validation failures on data a person typed,
 * not authorization or existence problems. `apps/web`'s `auxxErrorMiddleware`
 * maps them without anything further.
 */

import { UnprocessableEntityError } from '../errors'

/** Discriminant carried by every refusal below. */
export type SalvageRefusalReason =
  | 'nested_good_node'
  | 'quantity_exceeds_allowance'
  | 'missing_standard_cost'
  | 'salvage_percent_out_of_range'
  | 'over_return'
  | 'invalid_return_quantity'

/**
 * A `good` node that sits under another `good` node.
 *
 * Plan section 6.6 invariant 1. This is normally resolved by **selection**
 * rather than refusal - {@link selectSalvageMovementNodes} stops at the highest
 * `good` node, so the shadowed one simply produces no movement - and this error
 * exists for the surfaces that would rather tell the user than silently ignore
 * half of what they ticked.
 */
export class NestedGoodSalvageNodeError extends UnprocessableEntityError {
  readonly reason = 'nested_good_node' as const
  readonly nodeKey: string
  readonly ancestorKey: string
  readonly partName: string

  constructor(params: { nodeKey: string; ancestorKey: string; partName: string }) {
    super(
      `${params.partName} is marked good underneath another part that is already marked good. ` +
        'Only the highest good node in a branch is recovered.',
      { nodeKey: params.nodeKey, ancestorKey: params.ancestorKey, partName: params.partName }
    )
    this.nodeKey = params.nodeKey
    this.ancestorKey = params.ancestorKey
    this.partName = params.partName
  }
}

/**
 * Sibling rows for one part add up to more units than the parent can hold.
 *
 * Plan section 6.6 invariant 2. The allowance is the BOM quantity of that part
 * under the parent times the parent's own quantity, so the split button can
 * divide four units any way it likes and cannot invent a fifth.
 */
export class SalvageQuantityExceedsAllowanceError extends UnprocessableEntityError {
  readonly reason = 'quantity_exceeds_allowance' as const
  readonly parentKey: string
  readonly partId: string
  readonly partName: string
  readonly allowed: number
  readonly total: number

  constructor(params: {
    parentKey: string
    partId: string
    partName: string
    allowed: number
    total: number
  }) {
    super(
      `${params.partName}: ${params.total} units split under one parent that holds only ` +
        `${params.allowed}.`,
      { parentKey: params.parentKey, partId: params.partId, partName: params.partName }
    )
    this.parentKey = params.parentKey
    this.partId = params.partId
    this.partName = params.partName
    this.allowed = params.allowed
    this.total = params.total
  }
}

/**
 * A part that would be salvaged has no usable `part_standard_cost`.
 *
 * Plan sections 6.4 and 6.5. A zero passes every guard that tests `== null`,
 * and the handoff records 83 parts already rolled to `0`, so zero is refused
 * alongside null. The refusal **names the part**, because the fix is to cost
 * that part and press the button again - nothing is lost by refusing, since the
 * disposition is already recorded on the `return_part_line` row.
 */
export class MissingStandardCostError extends UnprocessableEntityError {
  readonly reason = 'missing_standard_cost' as const
  readonly partId: string
  readonly partName: string
  readonly standardCost: number | null

  constructor(params: { partId: string; partName: string; standardCost: number | null }) {
    super(
      `${params.partName} has no standard cost, so it cannot be salvaged. ` +
        'Set a standard cost for the part and salvage it again.',
      { partId: params.partId, partName: params.partName }
    )
    this.partId = params.partId
    this.partName = params.partName
    this.standardCost = params.standardCost
  }
}

/**
 * `salvagePercent` outside `0 < pct <= 100` (plan section 6.4, guards 1 and 2).
 *
 * At or below zero the part is worthless, and a worthless part is `scrap`,
 * which writes no movement at all - not a zero-cost one. Above 100 the salvage
 * would be worth more than a new part.
 */
export class SalvagePercentOutOfRangeError extends UnprocessableEntityError {
  readonly reason = 'salvage_percent_out_of_range' as const
  readonly partId: string
  readonly partName: string
  readonly salvagePercent: number

  constructor(params: { partId: string; partName: string; salvagePercent: number }) {
    super(
      `${params.partName}: a salvage percentage of ${params.salvagePercent} is outside the ` +
        'permitted range (greater than 0, at most 100).',
      { partId: params.partId, partName: params.partName }
    )
    this.partId = params.partId
    this.partName = params.partName
    this.salvagePercent = params.salvagePercent
  }
}

/**
 * More units would come back against a sold line than ever left (plan section 3.5).
 */
export class OverReturnError extends UnprocessableEntityError {
  readonly reason = 'over_return' as const
  readonly lineItemId: string
  readonly ceiling: number
  readonly alreadyReturned: number
  readonly requested: number

  constructor(params: {
    lineItemId: string
    ceiling: number
    alreadyReturned: number
    requested: number
  }) {
    super(
      `Returning ${params.requested} would bring back ` +
        `${params.alreadyReturned + params.requested} units against a line of ` +
        `${params.ceiling}.`,
      { lineItemId: params.lineItemId }
    )
    this.lineItemId = params.lineItemId
    this.ceiling = params.ceiling
    this.alreadyReturned = params.alreadyReturned
    this.requested = params.requested
  }
}

/**
 * A returned quantity that is not a positive finite number.
 *
 * Separate from {@link OverReturnError} because a negative quantity passes any
 * ceiling comparison and would then restock parts for units that never shipped
 * - the exact failure the ceiling exists to prevent, arriving through the door
 * the ceiling does not watch.
 */
export class InvalidReturnQuantityError extends UnprocessableEntityError {
  readonly reason = 'invalid_return_quantity' as const
  readonly quantity: number

  constructor(params: { quantity: number }) {
    super(`A returned quantity must be a positive number, got ${params.quantity}.`, {})
    this.quantity = params.quantity
  }
}

/** Every refusal this module can return. */
export type SalvageRefusal =
  | NestedGoodSalvageNodeError
  | SalvageQuantityExceedsAllowanceError
  | MissingStandardCostError
  | SalvagePercentOutOfRangeError
  | OverReturnError
  | InvalidReturnQuantityError
