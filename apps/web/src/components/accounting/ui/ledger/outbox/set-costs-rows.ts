// apps/web/src/components/accounting/ui/ledger/outbox/set-costs-rows.ts

import { minorToMajorString, parseMajorToMinor, RATE_DECIMALS } from '@auxx/utils/currency'

/** One part in the Set costs grid (106 §6.2). */
export interface SetCostsRow {
  partId: string
  name: string
  /** Shipments waiting on this part's standard. */
  waiting: number
  /** `part_channel_cost`, minor units per unit; null when the channel reports none. */
  channelCost: number | null
  /** The part's stored `part_kind`; null when unset. */
  kind: string | null
}

/** What a person typed or picked on one row. `unitCost` undefined means never touched. */
export interface SetCostsDraft {
  unitCost?: string
  kind?: string
}

export type SetCostsDrafts = Readonly<Record<string, SetCostsDraft>>

export interface SetCostsItem {
  partId: string
  unitCost: number
  kind?: string
}

/** Some read paths return a SINGLE_SELECT as a one-element array. */
function optionValue(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value
  return typeof first === 'string' && first ? first : null
}

/** Rows from the reason's per-part groups and the parts' field values (keyed by part id). */
export function buildSetCostsRows(
  groups: readonly { externalRef: string | null; refLabel: string | null; count: number }[],
  valuesByPartId: Readonly<Record<string, Record<string, unknown> | undefined>>
): SetCostsRow[] {
  const rows: SetCostsRow[] = []
  const seen = new Set<string>()
  for (const group of groups) {
    const partId = group.externalRef
    if (!partId || seen.has(partId)) continue
    seen.add(partId)
    const values = valuesByPartId[partId]
    const channel = values?.part_channel_cost
    rows.push({
      partId,
      name: group.refLabel ?? partId,
      waiting: group.count,
      channelCost: typeof channel === 'number' && Number.isFinite(channel) ? channel : null,
      kind: optionValue(values?.part_kind),
    })
  }
  return rows
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

/** Channel costs into every row nobody has typed in yet; returns the same object when nothing changes. */
export function seedChannelCosts(
  rows: readonly SetCostsRow[],
  drafts: SetCostsDrafts,
  currencyCode = 'USD'
): SetCostsDrafts {
  return fill(rows, drafts, currencyCode, (draft) => draft?.unitCost === undefined)
}

/** "Use channel costs": every blank unit cost that has a channel cost. */
export function fillChannelCosts(
  rows: readonly SetCostsRow[],
  drafts: SetCostsDrafts,
  currencyCode = 'USD'
): SetCostsDrafts {
  return fill(rows, drafts, currencyCode, (draft) => !draft?.unitCost?.trim())
}

function fill(
  rows: readonly SetCostsRow[],
  drafts: SetCostsDrafts,
  currencyCode: string,
  blank: (draft: SetCostsDraft | undefined) => boolean
): SetCostsDrafts {
  let next: Record<string, SetCostsDraft> | null = null
  for (const row of rows) {
    if (row.channelCost === null || !blank(drafts[row.partId])) continue
    next ??= { ...drafts }
    next[row.partId] = {
      ...drafts[row.partId],
      unitCost: formatUnitCostInput(row.channelCost, currencyCode),
    }
  }
  return next ?? drafts
}

/**
 * The save payload: rows with a unit cost or a changed kind. A service takes no cost, so a stored
 * one is skipped; any other kind change needs a cost, since the mutation writes a standard with it.
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
      items.push({ partId: row.partId, unitCost: cost.value, ...(kind ? { kind } : {}) })
    } else if (kind) {
      errors[row.partId] = 'Enter a unit cost to change the kind'
    }
  }
  return { items, errors }
}
