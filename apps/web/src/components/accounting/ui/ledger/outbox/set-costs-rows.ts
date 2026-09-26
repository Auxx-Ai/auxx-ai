// apps/web/src/components/accounting/ui/ledger/outbox/set-costs-rows.ts

import {
  type StandardCostSuggestion,
  suggestStandardCost,
} from '@auxx/lib/inventory/costing/client'
import { minorToMajorString, parseMajorToMinor, RATE_DECIMALS } from '@auxx/utils/currency'
import { type CountedGroup, sourceBreakdown } from './blocked-levels'

/** The worklist fields a row reads (`builds.standardCostWorklist`, 09 D-SC3). */
export interface SetCostsPartState {
  partId: string
  name: string
  kind: string | null
  hasBom: boolean
  standardCost: number | null
  purchaseCost: number | null
  channelCost: number | null
  usedIn: number
  uncostedLeafCount: number
  isLeaf: boolean
}

/** One part in the Set costs grid (106 §6.2, 09 D-SC3). */
export interface SetCostsRow {
  partId: string
  name: string
  /** Documents waiting on this part's standard: shipments, builds and counts (111 Q18). */
  waiting: number
  /** `waiting` per kind, "446 shipments · 12 builds · 1 count"; one figure when the read has no split. */
  waitingLabel: string
  /** The part's stored `part_kind`; null when unset. */
  kind: string | null
  /** A BOM part takes no typed cost unless "Set cost instead" (D-SC3). */
  hasBom: boolean
  /** Minor units; a BOM part's rolled standard once its leaves are costed. */
  standardCost: number | null
  uncostedLeafCount: number
  usedIn: number
  /** Listed because it sits under a blocked BOM part, not blocked itself. */
  isLeaf: boolean
  /** D-SC4 prefill; always null for a BOM part. */
  suggestion: StandardCostSuggestion | null
  /** Both costs, shown as hints under "Set cost instead". */
  purchaseCost: number | null
  channelCost: number | null
}

/** What a person typed or picked on one row. `unitCost` undefined means never touched. */
export interface SetCostsDraft {
  unitCost?: string
  kind?: string
  /** `unitCost` is the untouched D-SC4 suggestion. */
  suggested?: boolean
  /** "Set cost instead" on a BOM part. */
  override?: boolean
}

export type SetCostsDrafts = Readonly<Record<string, SetCostsDraft>>

export interface SetCostsItem {
  partId: string
  unitCost: number
  kind?: string
  overrideBom?: true
}

type BlockedGroup = CountedGroup & { externalRef: string | null; refLabel: string | null }

/**
 * Rows in worklist order (blocked parts, then their uncosted leaves). Without a worklist, every
 * group is a plain editable row. A part no longer blocked keeps its row with nothing waiting.
 */
export function buildSetCostsRows(
  groups: readonly BlockedGroup[],
  parts: readonly SetCostsPartState[] | undefined
): SetCostsRow[] {
  const byPart = new Map<string, BlockedGroup>()
  for (const group of groups) {
    if (group.externalRef && !byPart.has(group.externalRef)) byPart.set(group.externalRef, group)
  }
  const waitingOf = (partId: string, isLeaf: boolean) => {
    const group = byPart.get(partId)
    if (group) return { waiting: group.count, waitingLabel: sourceBreakdown(group) }
    return { waiting: 0, waitingLabel: isLeaf ? 'Not blocked' : 'Nothing waiting' }
  }

  if (!parts) {
    return [...byPart.entries()].map(([partId, group]) => ({
      partId,
      name: group.refLabel ?? partId,
      ...waitingOf(partId, false),
      kind: null,
      hasBom: false,
      standardCost: null,
      uncostedLeafCount: 0,
      usedIn: 0,
      isLeaf: false,
      suggestion: null,
      purchaseCost: null,
      channelCost: null,
    }))
  }
  return parts.map((part) => ({
    partId: part.partId,
    name: part.name || byPart.get(part.partId)?.refLabel || part.partId,
    ...waitingOf(part.partId, part.isLeaf),
    kind: part.kind,
    hasBom: part.hasBom,
    standardCost: part.standardCost,
    uncostedLeafCount: part.uncostedLeafCount,
    usedIn: part.usedIn,
    isLeaf: part.isLeaf,
    suggestion: part.hasBom ? null : suggestStandardCost(part.purchaseCost, part.channelCost),
    purchaseCost: part.purchaseCost,
    channelCost: part.channelCost,
  }))
}

/** Whether the row takes a typed cost now: no BOM, or "Set cost instead" was chosen. */
export function isEditableRow(row: SetCostsRow, draft: SetCostsDraft | undefined): boolean {
  return !row.hasBom || draft?.override === true
}

/** "No BOM, costed as bought" (D-SC2 guard): a finished good typed with no BOM to roll from. */
export function isBoughtFinishedGood(row: SetCostsRow, kind: string): boolean {
  return kind === 'finished_good' && !row.hasBom
}

/** "From supplier" / "From channel". */
export function suggestionSourceLabel(source: 'supplier' | 'channel'): string {
  return source === 'supplier' ? 'From supplier' : 'From channel'
}

/** The input text for a minor-unit amount, at rate precision. */
export function formatUnitCostInput(minor: number, currencyCode = 'USD'): string {
  return minorToMajorString(minor, currencyCode, RATE_DECIMALS)
}

/** Parse a typed unit cost to minor units: blank is null, anything else a number ≥ 0 or an error. */
export function parseUnitCost(
  input: string | undefined,
  currencyCode = 'USD'
): { ok: true; value: number | null } | { ok: false; error: string } {
  const text = (input ?? '').replace(/[\s$,]/g, '')
  if (!text) return { ok: true, value: null }
  if (!/^(\d+\.?\d*|\.\d+)$/.test(text)) return { ok: false, error: 'Enter an amount like 12.50' }
  const value = parseMajorToMinor(text, currencyCode, RATE_DECIMALS)
  if (value === null || !Number.isFinite(value)) {
    return { ok: false, error: 'Enter an amount like 12.50' }
  }
  return { ok: true, value }
}

/** D-SC4 suggestions into every editable row nobody has typed in; same object when nothing changes. */
export function seedSuggestions(
  rows: readonly SetCostsRow[],
  drafts: SetCostsDrafts,
  currencyCode = 'USD'
): SetCostsDrafts {
  let next: Record<string, SetCostsDraft> | null = null
  for (const row of rows) {
    const draft = drafts[row.partId]
    if (!row.suggestion || row.hasBom || draft?.unitCost !== undefined) continue
    next ??= { ...drafts }
    next[row.partId] = {
      ...draft,
      unitCost: formatUnitCostInput(row.suggestion.unitCost, currencyCode),
      suggested: true,
    }
  }
  return next ?? drafts
}

/**
 * The save payload: editable rows with a unit cost or a changed kind. A service takes no cost, so a
 * stored one is skipped; any other kind change needs a cost, since the mutation writes a standard.
 */
export function toSetCostsItems(
  rows: readonly SetCostsRow[],
  drafts: SetCostsDrafts,
  options: { currencyCode?: string; skip?: ReadonlySet<string> } = {}
): { items: SetCostsItem[]; errors: Record<string, string> } {
  const items: SetCostsItem[] = []
  const errors: Record<string, string> = {}
  for (const row of rows) {
    if (options.skip?.has(row.partId)) continue
    const draft = drafts[row.partId]
    if (!isEditableRow(row, draft)) continue
    const overrideBom = row.hasBom ? ({ overrideBom: true } as const) : {}
    const kind = draft?.kind && draft.kind !== row.kind ? draft.kind : undefined
    if ((kind ?? row.kind) === 'service') {
      if (kind) items.push({ partId: row.partId, unitCost: 0, kind })
      continue
    }
    const cost = parseUnitCost(draft?.unitCost, options.currencyCode)
    if (!cost.ok) {
      errors[row.partId] = cost.error
      continue
    }
    if (cost.value !== null) {
      items.push({
        partId: row.partId,
        unitCost: cost.value,
        ...(kind ? { kind } : {}),
        ...overrideBom,
      })
    } else if (kind) {
      errors[row.partId] = 'Enter a unit cost to change the kind'
    }
  }
  return { items, errors }
}
