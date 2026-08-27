// packages/lib/src/purchasing/allocate-landed-cost.ts

import { BadRequestError } from '../errors'
import { roundCents } from '../money/totals'
import type { AllocationBasis, AllocationHeader, AllocationLine } from './types'

/**
 * Freight, tax and header discount spread across the lines of one purchase
 * (build plan section 4.3; costing plan section 4.2).
 *
 * Why this exists at all: `vendor_part.shippingCost` is a flat per-unit number,
 * so a $400 freight bill covering five parts has to be pre-divided by hand.
 * A hand-divided guess cannot be reconciled back to the freight invoice, and
 * reconciling to the freight invoice is the entire point of capitalising
 * freight — otherwise the gap between `vendorUnitPrice` and `unitCost` answers
 * "was it the motor or the freight" with a number somebody made up.
 */

const BASES: readonly AllocationBasis[] = ['value', 'quantity', 'weight']

function assertMinorUnits(value: number, label: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new BadRequestError(`${label} must be an integer amount in minor units`)
  }
}

function assertLine(line: AllocationLine, index: number): void {
  assertMinorUnits(line.lineTotal, `Line ${index} lineTotal`)
  if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
    // A zero-quantity line has no unit to carry a unit cost, and a negative one
    // is a return, which belongs on its own document rather than diluting an
    // allocation. Both are caller bugs, not tolerable inputs.
    throw new BadRequestError(`Line ${index} quantity must be greater than zero`)
  }
  if (line.weight !== undefined) {
    if (!Number.isFinite(line.weight) || line.weight < 0) {
      throw new BadRequestError(`Line ${index} weight must be a non-negative number`)
    }
  }
}

/**
 * Refuse a PARTIAL weight set under basis 'weight' (receiving plan section 5.3).
 *
 * The asymmetry with the all-zero fallback below is deliberate, and it is a
 * difference in what the input MEANS rather than in how hard it is to divide:
 *
 * - All weights zero or absent carries NO information. An equal split is the
 *   only defensible answer, it reconciles to the header exactly, and nobody
 *   reading it can mistake it for a considered allocation — there was nothing
 *   to consider.
 * - Some weights present and some not carries MISLEADING information. It
 *   divides cleanly, so nothing throws; it produces a lopsided vector that
 *   looks deliberate, so nothing reads as wrong; and the unweighed lines land
 *   at exactly zero freight while the weighed ones carry all of it. A landed
 *   cost that is silently wrong and looks right is the failure this whole
 *   module exists to avoid.
 *
 * So: a weight is not a per-line property that means something on its own, the
 * way a line total does. It is a basis input that only means anything across
 * the whole set, and half a set is not a partly-configured allocation — it is a
 * broken one. The guard lives here rather than only in the line builder because
 * the bill-side caller (plan section 4.2) needs the same protection.
 *
 * Zero is treated as absent: a zero-weight line among weighed lines has the
 * identical silent-zero-share problem, and there is no way to tell "weighs
 * nothing" from "not weighed yet" in the stored value.
 */
function assertWeightBasis(lines: AllocationLine[]): void {
  const weighed = lines.filter((line) => (line.weight ?? 0) > 0).length
  if (weighed === 0 || weighed === lines.length) return
  const index = lines.findIndex((line) => (line.weight ?? 0) <= 0)
  throw new BadRequestError(
    `Line ${index} has no weight; allocating by weight requires a weight on every line or none`
  )
}

function assertHeader(header: AllocationHeader): void {
  assertMinorUnits(header.shipping, 'Header shipping')
  assertMinorUnits(header.tax, 'Header tax')
  assertMinorUnits(header.discount, 'Header discount')
}

/** The per-line share weights for a basis. All non-negative; may sum to zero. */
function basisWeights(lines: AllocationLine[], basis: AllocationBasis): number[] {
  switch (basis) {
    case 'value':
      return lines.map((line) => Math.max(line.lineTotal, 0))
    case 'quantity':
      return lines.map((line) => line.quantity)
    case 'weight':
      return lines.map((line) => line.weight ?? 0)
  }
}

/**
 * The header amount that actually becomes part of what the goods cost.
 *
 * Tax is included only when it is NOT recoverable: an org reclaiming input tax
 * holds a receivable from the tax authority, not more expensive inventory.
 */
export function capitalisableAmount(header: AllocationHeader): number {
  assertHeader(header)
  return header.shipping + (header.taxRecoverable ? 0 : header.tax) - header.discount
}

/**
 * The per-line ADDER — how many minor units of the header land on each line,
 * before it is divided down to a unit cost.
 *
 * Exported separately from `allocateLandedCost` because this is the vector that
 * has to reconcile: `sum(result) === capitalisableAmount(header)` EXACTLY, for
 * every input. Rounding is not incidental here (build plan section 4.3). A
 * per-line `Math.round` leaves a stray cent or two against the freight invoice,
 * and a landed cost that cannot be tied back to the invoice it came from is
 * just a different made-up number. So: allocate pro-rata, round each line, then
 * push the whole residual onto the heaviest line — the one whose own rounding
 * error is proportionally smallest, and the one a reviewer would pick by hand.
 *
 * Degenerate inputs fall back rather than divide by zero:
 * - no lines: an empty vector (nothing to allocate to)
 * - every weight zero (basis 'weight' with no weights recorded, basis 'value'
 *   with all-zero line totals): an equal split across the lines, because
 *   "spread it evenly" is the only defensible answer when the basis carries no
 *   information, and it still reconciles to the header exactly.
 *
 * A PARTIAL weight set under basis 'weight' is the one shape that is refused
 * instead of absorbed — see `assertWeightBasis` for why all-absent is honest
 * and half-absent is not. Only 'weight' is affected: a zero line total under
 * 'value' is a legitimate free item and a zero quantity is already rejected
 * outright.
 *
 * @throws BadRequestError on a non-integer money amount, a quantity that is not
 *   greater than zero, a negative weight, a weight on only some lines under
 *   basis 'weight', or an unknown basis.
 */
export function allocateCapitalisedCost(
  lines: AllocationLine[],
  header: AllocationHeader,
  basis: AllocationBasis
): number[] {
  if (!BASES.includes(basis)) {
    throw new BadRequestError(`Unknown allocation basis: ${String(basis)}`)
  }
  lines.forEach(assertLine)
  if (basis === 'weight') assertWeightBasis(lines)
  const capitalisable = capitalisableAmount(header)
  if (lines.length === 0) return []

  const rawWeights = basisWeights(lines, basis)
  const rawTotal = rawWeights.reduce((sum, weight) => sum + weight, 0)
  // Equal split when the basis carries no information at all.
  const weights = rawTotal > 0 ? rawWeights : rawWeights.map(() => 1)
  const totalWeight = rawTotal > 0 ? rawTotal : weights.length

  const allocated = weights.map((weight) => roundCents((capitalisable * weight) / totalWeight))

  // Reconcile: the residual is at most (lines.length - 1) minor units in either
  // direction, and all of it goes to the heaviest line.
  const residual = capitalisable - allocated.reduce((sum, amount) => sum + amount, 0)
  if (residual !== 0) {
    let heaviest = 0
    let heaviestWeight = weights[0] ?? 0
    for (let i = 1; i < weights.length; i++) {
      const weight = weights[i] ?? 0
      if (weight > heaviestWeight) {
        heaviest = i
        heaviestWeight = weight
      }
    }
    allocated[heaviest] = (allocated[heaviest] ?? 0) + residual
  }

  return allocated
}

/**
 * Landed UNIT cost per line, integer minor units — the number that is written to
 * `stock_movement.unitCost` when a purchase order is received (build plan
 * section 4.3).
 *
 * `(lineTotal + allocated share) / quantity`, rounded to a whole minor unit.
 * The rounding decision: the ADDERS reconcile to the header exactly (see
 * `allocateCapitalisedCost`); the unit costs are then a second, independent
 * rounding of `landed line total / quantity` and do NOT re-multiply back to the
 * line total when the quantity does not divide evenly. That is the correct
 * split of concerns — the freight invoice is what has to tie out, and it does,
 * while a unit cost is a per-unit rate that is inherently a rounded quotient.
 * Callers that need the exact landed line total should use
 * `allocateCapitalisedCost` and add it to `lineTotal` themselves.
 *
 * Worked example (costing plan section 4.2, purchase HZRA2W): lines of $1,000
 * and $1, one unit each, $10,000 shipping, basis 'value'. The $1 line lands at
 * `1 + 10000 x (1/1001)` = $10.99001 exactly, which is 1099 minor units once
 * rounded — and the two adders sum to the $10,000 freight bill to the cent.
 *
 * @throws BadRequestError on a non-integer money amount, a quantity that is not
 *   greater than zero, a negative weight, a weight on only some lines under
 *   basis 'weight', or an unknown basis.
 */
export function allocateLandedCost(
  lines: AllocationLine[],
  header: AllocationHeader,
  basis: AllocationBasis
): number[] {
  const allocated = allocateCapitalisedCost(lines, header, basis)
  return lines.map((line, index) =>
    roundCents((line.lineTotal + (allocated[index] ?? 0)) / line.quantity)
  )
}
