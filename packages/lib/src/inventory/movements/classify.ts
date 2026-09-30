// packages/lib/src/inventory/movements/classify.ts

import type { StockMovementConsumptionClassValue } from '@auxx/database/enums'
import { StockMovementType } from '../../resources/registry/enum-values'

/** How a movement counts for planning; `StockMovement.consumptionClass`. */
export type ConsumptionClass = StockMovementConsumptionClassValue

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

/** A movement as classification reads it; a set `consumptionClass` is taken as is. */
export interface MovementClassRow {
  id: string
  type: string
  reversesMovementId?: string | null
  parentMovementId?: string | null
  consumptionClass?: ConsumptionClass | null
}

/** Classify rows together, a reversal through its original's class (chains walked, cycles cut). */
export function classifyMovementRows(
  rows: readonly MovementClassRow[]
): Map<string, ConsumptionClass> {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const classes = new Map<string, ConsumptionClass>()
  const resolve = (row: MovementClassRow, seen: Set<string>): ConsumptionClass => {
    const known = classes.get(row.id) ?? row.consumptionClass
    if (known) {
      classes.set(row.id, known)
      return known
    }
    seen.add(row.id)
    const original = row.reversesMovementId ? byId.get(row.reversesMovementId) : undefined
    const reversesClass = original && !seen.has(original.id) ? resolve(original, seen) : undefined
    const result = classifyMovement(row.type, {
      reversesClass,
      parentMovementId: row.parentMovementId,
      isSalvage: !row.reversesMovementId,
    })
    classes.set(row.id, result)
    return result
  }
  for (const row of rows) resolve(row, new Set())
  return classes
}
