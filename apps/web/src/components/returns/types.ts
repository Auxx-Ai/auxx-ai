// apps/web/src/components/returns/types.ts

// The salvage tree's wire shape (plans/money/tasks/54-returns.md §6.6).
//
// 🛑 TEMPORARY HOME. This is declared here only because the `return`,
// `return_line` and `return_part_line` definitions do not exist yet and
// `@auxx/lib/returns/client` therefore does not exist either. Wave 2 moves this
// file's contents there verbatim and rewires the three importers below it; the
// SHAPE is fixed and must not drift, because the lib side is being written
// against the identical declaration.
//
// A node is NOT the same thing as a `return_part_line` row. The tree the user
// sees is `loadSubpartGraph`'s in-memory BOM map; a row exists only for a node
// somebody actually touched (`materialized`). §6.6: "a node with no row is
// `undecided` by absence", which is what keeps the table small and the salvage
// writer's input honest.

import type { SelectOptionColor } from '@auxx/types/custom-field'

/** The five conditions a returned component can be in. §3.6. */
export type SalvageStatus = 'good' | 'damaged' | 'scrap' | 'missing' | 'undecided'

/** One node of the BOM tree hanging off a return line. */
export interface SalvageNode {
  /**
   * Stable identity for this node in THIS tree, unique across the whole tree.
   *
   * Not a part id and not a record id: the split button (§6.6) puts two
   * siblings on the same part under the same parent, so a part id cannot key a
   * row. Treat it as opaque.
   */
  key: string
  partId: string
  partName: string
  partNumber: string | null
  /** 0-based depth below the return line. Drives the indent. */
  depth: number
  /** Prefilled as BOM quantity times the return line's quantity. §6.6. */
  quantity: number
  status: SalvageStatus
  /** 0 < pct <= 100. Only meaningful on a `good` node, which is the only kind that posts. §6.4. */
  salvagePercent: number
  /** The BOM says this part has subparts, so the row can be drilled into. */
  hasChildren: boolean
  /** A `return_part_line` row exists for this node. `false` means undecided by absence. */
  materialized: boolean
  /** `null` means NOT YET EXPANDED — children are materialized on first expand, never up front. */
  children: SalvageNode[] | null
}

/**
 * Status options in the order the warehouse works through them, shaped as
 * `FieldOptions['options']` so `FieldInputAdapter` renders the same coloured
 * badge select every other enum in the product gets.
 */
export const SALVAGE_STATUS_OPTIONS: Array<{
  value: SalvageStatus
  label: string
  color: SelectOptionColor
}> = [
  { value: 'undecided', label: 'Undecided', color: 'gray' },
  { value: 'good', label: 'Good', color: 'green' },
  { value: 'damaged', label: 'Damaged', color: 'amber' },
  { value: 'scrap', label: 'Scrap', color: 'red' },
  { value: 'missing', label: 'Missing', color: 'orange' },
]

/** Narrow an unknown select value back to a {@link SalvageStatus}. */
export function toSalvageStatus(value: unknown): SalvageStatus | null {
  return SALVAGE_STATUS_OPTIONS.some((option) => option.value === value)
    ? (value as SalvageStatus)
    : null
}

/** Label for a status, for tooltips and confirm copy. */
export function salvageStatusLabel(status: SalvageStatus): string {
  return SALVAGE_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? 'Undecided'
}
