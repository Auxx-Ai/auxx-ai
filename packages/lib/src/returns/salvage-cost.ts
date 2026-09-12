// packages/lib/src/returns/salvage-cost.ts

/**
 * Plan section 6.4's arithmetic, and nothing else: what one salvaged unit is
 * worth, given the part's standard cost and the percentage the warehouse set.
 *
 * ```
 * unitCost = round(part_standard_cost * salvagePercent / 100)
 * ```
 *
 * **Standard, not the ledger average, and that is a decision rather than an
 * oversight.** Task 50 prices relief at the part's ledger-derived average and
 * argues against standard; salvage keeps standard anyway, for reasons plan
 * section 6.4 sets out in full. The one that matters here: no org holds a
 * single `initial` movement and builds are not backfilled, so most parts have
 * `V = 0, Q = 0` and **no average exists** - an average basis would refuse or
 * fall back on most rows the day it shipped. There is deliberately no
 * ledger-average read in this file, and adding one would drag opening stock and
 * backfilled builds in as gates on the salvage writer.
 *
 * Rounding happens **once, here**. The extended cost stays `computeExtendedCost`'s
 * job (`receiving/client.ts`), which rounds the product and not the factors.
 */

import { RATE_DECIMALS, roundMinor } from '@auxx/utils/currency'
import { err, ok, type Result } from 'neverthrow'
import { MissingStandardCostError, SalvagePercentOutOfRangeError } from './salvage-errors'

/** One salvage valuation. All amounts are minor units. */
export interface SalvageUnitCostInput {
  partId: string
  partName: string
  /** `part_standard_cost`, in minor units. Null, zero and negative all refuse. */
  standardCost: number | null | undefined
  /** `return_part_line.salvagePercent`. Must be greater than 0 and at most 100. */
  salvagePercent: number
}

/**
 * Is this a `part_standard_cost` a movement may be valued at?
 *
 * 🛑 Zero is not a standard. Task 26 fixed the roll, but the handoff records 83
 * parts already rolled to `0`, and a zero passes every guard that tests
 * `== null` - which is how a $0 unit cost gets frozen onto an append-only
 * ledger where nothing can restate it.
 */
export function isUsableStandardCost(cost: number | null | undefined): cost is number {
  return typeof cost === 'number' && Number.isFinite(cost) && cost > 0
}

/** Is this a `salvagePercent` the writer accepts? `0 < pct <= 100`. */
export function isUsableSalvagePercent(pct: number): boolean {
  return Number.isFinite(pct) && pct > 0 && pct <= 100
}

/**
 * The unit cost to freeze onto a salvage `return_in` movement.
 *
 * Three guards, all refusals rather than corrections (plan section 6.4):
 *
 * 1. `pct <= 0` refuses. A worthless part is `scrap`, and scrap writes **no
 *    movement at all** (section 6.3) - not a zero-cost one.
 * 2. `pct > 100` refuses. Salvage is never worth more than new.
 * 3. A null, zero or negative standard cost refuses, **naming the part**.
 *
 * Refusing costs nothing here, which is why this diverges from task 50 section
 * 4.2's relief writer, which warns and never refuses: a refused relief loses a
 * shipment that really happened and cannot be re-derived, while a refused
 * salvage loses nothing, because the disposition is already on the
 * `return_part_line` and the movement can be written the moment somebody costs
 * the part. Two writers, two answers. Do not harmonise them.
 *
 * The result is rounded to a RATE's precision (`RATE_DECIMALS`), the same as
 * every other per-each cost stamped on a movement - a standard cost may itself
 * carry fractional cents, and collapsing a salvage to whole cents would make a
 * 60% recovery of a 1.5-cent fastener cost a whole cent.
 */
export function computeSalvageUnitCost(
  input: SalvageUnitCostInput
): Result<number, MissingStandardCostError | SalvagePercentOutOfRangeError> {
  if (!isUsableSalvagePercent(input.salvagePercent)) {
    return err(
      new SalvagePercentOutOfRangeError({
        partId: input.partId,
        partName: input.partName,
        salvagePercent: input.salvagePercent,
      })
    )
  }
  if (!isUsableStandardCost(input.standardCost)) {
    return err(
      new MissingStandardCostError({
        partId: input.partId,
        partName: input.partName,
        standardCost: input.standardCost ?? null,
      })
    )
  }

  // The one rounding in the whole salvage valuation.
  return ok(roundMinor((input.standardCost * input.salvagePercent) / 100, RATE_DECIMALS))
}
