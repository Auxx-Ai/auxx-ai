// apps/web/src/components/manufacturing/builds/completion-input.ts

// The completion form's pure half: what the browser sends, and what it renders.
//
// Split out of `complete-build-dialog.tsx` for the same reason `receipt-input.ts`
// is split out of the receive popover — the preview under the form and the
// payload the mutation sends must be derived from ONE description of the form's
// state, not by two expressions that happen to agree today.
//
// 🛑 Nothing here computes money. The five cost numbers come from
// `summarizeBuildCompletion` in `@auxx/lib/builds/client`, which is the same
// function `completeBuild` runs on the server, so the variance on screen is the
// variance that gets frozen.

import type { BuildComponentLine } from '@auxx/lib/builds/client'

/** One override the person actually typed, keyed by the consumed part. */
export type OverrideMap = Readonly<Record<string, number>>

/**
 * A component row as the form renders it.
 *
 * Assembled by {@link mergeComponentRows} rather than read straight off the
 * plan, because a line the person overrode to **zero** is dropped by the server
 * (a zero-quantity movement is not written) and would otherwise vanish from the
 * form mid-edit with no way to put it back.
 */
export interface ComponentRow {
  partId: string
  partName: string | null
  /**
   * The as-built bill-of-materials snapshot, per produced unit.
   *
   * 🛑 `null` is the **off-BOM marker**, not missing data: this part is not on
   * the bill of materials at all, so its movement will carry
   * `stock_movement_qty_per_unit = NULL` — a floor substitution made visible
   * instead of silent (Gap C §4.1, §8.3).
   */
  qtyPerUnit: number | null
  /** True when this row exists only because somebody added it. */
  offBom: boolean
  /** What the run will consume. `0` means the person zeroed it and no row is written. */
  quantityConsumed: number
  /** `round(unitCost x quantityConsumed)`, positive. `null` when the part has no standard. */
  extendedCost: number | null
  /** The component's frozen `part_standard_cost`. `null` = never rolled. */
  unitCost: number | null
  /** True when the person typed this quantity rather than taking the bill of materials'. */
  overridden: boolean
  /** True when the server dropped the line — a zeroed row, kept visible so it can be restored. */
  dropped: boolean
}

/** What {@link mergeComponentRows} needs to keep a zeroed row on screen. */
export interface KnownComponent {
  partId: string
  partName: string | null
  qtyPerUnit: number | null
  offBom: boolean
}

/**
 * Every part the form has ever seen for this run, so a zeroed line stays visible.
 *
 * Accumulating rather than replacing is the whole point: `explodeBuildComponents`
 * returns the lines it would WRITE, and a line overridden to zero is not one of
 * them. Rebuilding the row list from each response alone would make the row
 * disappear the moment somebody typed `0`, taking the input that produced it
 * with it.
 */
export function rememberComponents(
  known: readonly KnownComponent[],
  lines: readonly BuildComponentLine[]
): KnownComponent[] {
  const merged = new Map(known.map((entry) => [entry.partId, entry]))
  for (const line of lines) {
    merged.set(line.partId, {
      partId: line.partId,
      partName: line.partName,
      qtyPerUnit: line.qtyPerUnit,
      offBom: line.offBom,
    })
  }
  return [...merged.values()]
}

/**
 * The rows to render: every remembered component, priced from the current plan.
 *
 * Bill-of-materials lines come first and off-BOM additions after, so a
 * substitution reads as an addition to the recipe rather than as a peer of it.
 */
export function mergeComponentRows(
  known: readonly KnownComponent[],
  lines: readonly BuildComponentLine[],
  overrides: OverrideMap
): ComponentRow[] {
  const byPart = new Map(lines.map((line) => [line.partId, line]))

  const rows = known.map((entry): ComponentRow => {
    const line = byPart.get(entry.partId)
    const override = overrides[entry.partId]
    return {
      partId: entry.partId,
      partName: line?.partName ?? entry.partName,
      qtyPerUnit: line?.qtyPerUnit ?? entry.qtyPerUnit,
      offBom: line?.offBom ?? entry.offBom,
      quantityConsumed: line?.quantityConsumed ?? override ?? 0,
      extendedCost: line?.extendedCost ?? null,
      unitCost: line?.unitCost ?? null,
      overridden: override != null,
      dropped: !line,
    }
  })

  return rows.sort((a, b) => Number(a.offBom) - Number(b.offBom))
}

/**
 * The `componentOverrides` payload — one entry per quantity the person stated.
 *
 * 🛑 An untouched line sends **nothing**, and that is deliberate: the server then
 * derives it from the bill of materials at the current produced/scrapped
 * quantities, so editing "produced" still moves every line the floor did not
 * comment on. An override is an absolute quantity for the WHOLE run, which is
 * why it does not move with them.
 *
 * A zero is kept, not filtered: it is how somebody says "we did not use this at
 * all", and the server drops the line rather than writing a zero-quantity
 * movement.
 */
export function buildComponentOverrides(
  overrides: OverrideMap
): { partId: string; quantityConsumed: number }[] {
  return Object.entries(overrides)
    .filter(([, quantity]) => Number.isFinite(quantity) && quantity >= 0)
    .map(([partId, quantityConsumed]) => ({ partId, quantityConsumed }))
}
