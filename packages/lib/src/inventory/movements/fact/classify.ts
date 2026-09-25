// packages/lib/src/inventory/movements/fact/classify.ts

import type { schema } from '@auxx/database'
import { StockMovementType } from '../../../resources/registry/enum-values'

/** How a movement counts for planning; the `InventoryConsumptionClass` enum. */
export type ConsumptionClass = (typeof schema.inventoryConsumptionClass.enumValues)[number]

/** What besides its type decides a movement's class. */
export interface MovementClassLinks {
  /** The ORIGINAL's class when this row reverses one; a reversal nets against it. */
  reversesClass?: ConsumptionClass | null
  parentMovementId?: string | null
  /** A `return_in` with no `reverses_movement`: a customer-return salvage. */
  isSalvage?: boolean
}

/** Classify one movement per plans/mrp/01-consumption-from-the-ledger.md §2. */
export function classifyMovement(type: string, links: MovementClassLinks = {}): ConsumptionClass {
  if (links.reversesClass) return links.reversesClass
  if (links.parentMovementId) return 'adjustment'
  switch (type) {
    case StockMovementType.SALE:
    case StockMovementType.SHIP:
    case StockMovementType.BUILD_CONSUME:
      return 'consumption'
    case StockMovementType.SCRAP:
      return 'scrap'
    case StockMovementType.RECEIVE:
    case StockMovementType.BUILD_PRODUCE:
    case StockMovementType.INITIAL:
    case StockMovementType.RETURN_OUT:
      return 'supply'
    // A return_in that is not salvage is a reversal whose original is unknown: a correction, not usage.
    case StockMovementType.RETURN_IN:
      return links.isSalvage ? 'supply' : 'adjustment'
    case StockMovementType.REVALUE:
      return 'none'
    default:
      return 'adjustment'
  }
}
