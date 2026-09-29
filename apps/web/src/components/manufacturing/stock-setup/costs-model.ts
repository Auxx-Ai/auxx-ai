// apps/web/src/components/manufacturing/stock-setup/costs-model.ts

// The pure half of Stock setup's Set costs step (plans/mrp/22 §3): rows, filters and what a
// per-source bulk press would write. Money is minor units at rate precision.

import {
  type StandardCostOriginValue,
  type StandardCostSourceValue,
  type StandardCostSuggestion,
  suggestStandardCost,
} from '@auxx/lib/inventory/costing/client'
import type { RouterOutputs } from '~/trpc/react'

export type CostWorklistPart = RouterOutputs['builds']['standardCostWorklist'][number]

/** Where a bulk cost comes from; `current` keeps the stored amount and only confirms it. */
export type CostSource = 'supplier' | 'channel' | 'current'

export type CostFilter = 'all' | 'no-cost' | 'has-supplier' | 'has-channel' | 'differ' | 'not-used'

export const COST_FILTERS: { value: CostFilter; label: string }[] = [
  { value: 'all', label: 'All parts' },
  { value: 'no-cost', label: 'No cost' },
  { value: 'has-supplier', label: 'Has supplier cost' },
  { value: 'has-channel', label: 'Has channel cost' },
  { value: 'differ', label: 'Supplier and channel differ' },
  { value: 'not-used', label: 'Not used yet' },
]

export function parseCostFilter(value: string | null | undefined): CostFilter {
  return COST_FILTERS.find((filter) => filter.value === value)?.value ?? 'all'
}

export type CostState = 'none' | 'provisional' | 'confirmed'

export interface CostRow {
  partId: string
  name: string
  sku: string | null
  hasBom: boolean
  usedIn: number
  needed: boolean
  quantityOnHand: number
  standardCost: number | null
  state: CostState
  origin: StandardCostOriginValue | null
  supplierCost: number | null
  channelCost: number | null
  suggestion: StandardCostSuggestion | null
  uncostedLeafIds: string[]
  supplierId: string | null
  supplierName: string | null
}

/** A stored $0 is "no price" (09 D-SC4); only a positive cost is a source. */
function positive(value: number | null): number | null {
  return value != null && Number.isFinite(value) && value > 0 ? value : null
}

/** Only a stored `confirmed` reads confirmed: a sourceless standard is one nobody accepted. */
function stateOf(standardCost: number | null, source: StandardCostSourceValue | null): CostState {
  if (standardCost == null) return 'none'
  return source === 'confirmed' ? 'confirmed' : 'provisional'
}

export function toCostRow(part: CostWorklistPart): CostRow {
  return {
    partId: part.partId,
    name: part.name || part.sku || part.partId,
    sku: part.sku,
    hasBom: part.hasBom,
    usedIn: part.usedIn,
    needed: part.needed,
    quantityOnHand: part.quantityOnHand,
    standardCost: part.standardCost,
    state: stateOf(part.standardCost, part.standardCostSource),
    origin: part.standardCostOrigin,
    supplierCost: positive(part.purchaseCost),
    channelCost: positive(part.channelCost),
    suggestion: part.hasBom ? null : suggestStandardCost(part.purchaseCost, part.channelCost),
    uncostedLeafIds: part.uncostedLeafIds,
    supplierId: part.supplierId,
    supplierName: part.supplierName,
  }
}

/** Most-used first, so the parts that unblock the most products lead; then by name. */
export function sortCostRows(rows: CostRow[]): CostRow[] {
  return [...rows].sort((a, b) => b.usedIn - a.usedIn || a.name.localeCompare(b.name))
}

export function matchesCostFilter(row: CostRow, filter: CostFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'no-cost':
      return row.state === 'none'
    case 'has-supplier':
      return row.supplierCost != null
    case 'has-channel':
      return row.channelCost != null
    case 'differ':
      return (
        row.supplierCost != null && row.channelCost != null && row.supplierCost !== row.channelCost
      )
    case 'not-used':
      return !row.needed
  }
}

/** The amount a source offers for a row, or `null` when it has none. */
export function sourceCost(row: CostRow, source: CostSource): number | null {
  if (row.hasBom) return null
  if (source === 'supplier') return row.supplierCost
  if (source === 'channel') return row.channelCost
  return row.standardCost
}

export const SOURCE_ORIGIN: Record<
  Exclude<CostSource, 'current'>,
  Extract<StandardCostOriginValue, 'supplier_price' | 'channel'>
> = {
  supplier: 'supplier_price',
  channel: 'channel',
}

export interface CostChange {
  row: CostRow
  from: number
  to: number
}

/** What one bulk press writes, split so a change is never hidden in the confirm. */
export interface SourcePlan {
  firstCosts: { row: CostRow; to: number }[]
  confirms: CostRow[]
  changes: CostChange[]
  /** Already confirmed at this amount: nothing to write. */
  unchanged: CostRow[]
  /** No cost from this source (or a BOM part): skipped, never guessed. */
  skipped: CostRow[]
  /** Σ on hand × (to − from) over the changes, signed minor units. */
  revaluationMinor: number
}

export function planSourceAction(rows: readonly CostRow[], source: CostSource): SourcePlan {
  const plan: SourcePlan = {
    firstCosts: [],
    confirms: [],
    changes: [],
    unchanged: [],
    skipped: [],
    revaluationMinor: 0,
  }
  for (const row of rows) {
    const to = sourceCost(row, source)
    if (to == null) {
      plan.skipped.push(row)
      continue
    }
    if (row.standardCost == null) {
      plan.firstCosts.push({ row, to })
    } else if (to === row.standardCost) {
      if (row.state === 'confirmed') plan.unchanged.push(row)
      else plan.confirms.push(row)
    } else {
      plan.changes.push({ row, from: row.standardCost, to })
      plan.revaluationMinor += Math.round((to - row.standardCost) * row.quantityOnHand)
    }
  }
  return plan
}

/** How many of `rows` a source button acts on: the rows it would write or confirm. */
export function sourceActionCount(rows: readonly CostRow[], source: CostSource): number {
  const plan = planSourceAction(rows, source)
  return plan.firstCosts.length + plan.confirms.length + plan.changes.length
}

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

/** `12 first costs · 4 confirmed as they are · 2 changes`, dropping the zeros. */
export function sourcePlanLine(plan: SourcePlan): string {
  return [
    plan.firstCosts.length > 0 && plural(plan.firstCosts.length, 'first cost', 'first costs'),
    plan.confirms.length > 0 &&
      `${plan.confirms.length.toLocaleString('en-US')} confirmed as they are`,
    plan.changes.length > 0 && plural(plan.changes.length, 'change', 'changes'),
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Made parts a build will produce that still wait on uncosted parts, with those parts' names. */
export function waitingProducts(
  parts: readonly CostWorklistPart[]
): { partId: string; name: string; waitingOn: string[] }[] {
  const names = new Map(parts.map((part) => [part.partId, part.name || part.sku || part.partId]))
  return parts
    .filter((part) => part.hasBom && part.standardCost == null && part.uncostedLeafIds.length > 0)
    .map((part) => ({
      partId: part.partId,
      name: names.get(part.partId) ?? part.partId,
      waitingOn: part.uncostedLeafIds.map((id) => names.get(id) ?? id).sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export type CostGroupBy = 'none' | 'supplier'

export const COST_GROUP_BYS: { value: CostGroupBy; label: string }[] = [
  { value: 'none', label: 'No grouping' },
  { value: 'supplier', label: 'Supplier' },
]

export interface CostGroup {
  key: string
  label: string
  rows: CostRow[]
  withoutCost: number
}

const NO_SUPPLIER = '__none__'

/** One group per supplier, by name; parts with no priced supplier offer last. Rows keep their order. */
export function groupBySupplier(rows: readonly CostRow[]): CostGroup[] {
  const groups = new Map<string, CostGroup>()
  for (const row of rows) {
    const key = row.supplierId ?? NO_SUPPLIER
    let group = groups.get(key)
    if (!group) {
      group = { key, label: row.supplierName ?? 'No supplier', rows: [], withoutCost: 0 }
      groups.set(key, group)
    }
    group.rows.push(row)
    if (row.state === 'none') group.withoutCost += 1
  }
  return [...groups.values()].sort((a, b) => {
    if (a.key === NO_SUPPLIER) return 1
    if (b.key === NO_SUPPLIER) return -1
    return a.label.localeCompare(b.label)
  })
}
