// packages/lib/src/inventory/relief/cogs-split.ts

/**
 * A relieved unit carries its whole frozen cost out of inventory, and 73 §6.2
 * rule 3 says where each part of it lands: `cogs_product_cost`,
 * `cogs_direct_labor` and `applied_overhead`, from the finished good's own
 * standard composition.
 *
 * PURE. The build module already stores that composition (`standard-cost.ts`
 * freezes material, labour and overhead separately); until now nothing read it
 * back out and the whole relief landed on one account.
 */

import type { PartStandardCost } from '../costing/types'
import { computeExtendedCost } from '../movements/client'

/** The three COGS legs of one relief, signed like the debit they make. */
export interface ReliefCostSplit {
  materialMinor: number
  laborMinor: number
  overheadMinor: number
}

/**
 * Split one line's COGS debit across the three roles.
 *
 * 🛑 **Material is the REMAINDER, never `standardMaterialCost x units`.** The
 * debit is whatever the movement's frozen extended cost was; deriving all three
 * legs independently would leave a rounding tail that the entry would then have
 * to plug somewhere, and a relief has no variance account to plug into.
 *
 * @param standard The finished good's frozen standard.
 * @param cogsDebitMinor The whole amount leaving inventory, signed: positive on
 *   a relief, negative on an un-relief.
 * @param units Units relieved, signed the same way.
 */
export function splitReliefCost(
  standard: PartStandardCost,
  cogsDebitMinor: number,
  units: number
): ReliefCostSplit {
  const laborMinor = computeExtendedCost(standard.standardLaborCost ?? 0, units)
  const overheadMinor = computeExtendedCost(standard.standardOverheadCost ?? 0, units)
  return {
    materialMinor: cogsDebitMinor - laborMinor - overheadMinor,
    laborMinor,
    overheadMinor,
  }
}
