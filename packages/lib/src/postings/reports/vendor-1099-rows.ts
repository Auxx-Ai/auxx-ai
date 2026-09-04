// packages/lib/src/postings/reports/vendor-1099-rows.ts
//
// PURE presentation shaping over `Vendor1099Summary`, split out of
// `vendor-1099.ts` for exactly the reason `adapters.ts` is split from
// `balance-sheet.ts`/`profit-and-loss.ts`/`trial-balance.ts`: the read imports
// `@auxx/database` at runtime, so it cannot be `client.ts`-safe, and the types
// plus the `toXRows`/CSV shaping the browser needs must live somewhere that
// imports nothing server-only. `vendor-1099.ts` re-exports everything here so a
// server caller only has one import site.

import { type StatementColumn, type StatementRow, toCsvRows, totalRow } from './rows'

/**
 * IRS filing threshold: a 1099-NEC/MISC is required only once a vendor's
 * calendar-year payments reach $600 (26 U.S.C. §6041; instructions to Forms
 * 1099-NEC/1099-MISC). Below this, an eligible vendor is simply omitted from
 * the summary - not flagged, not zeroed.
 */
export const VENDOR_1099_THRESHOLD_MINOR = 60_000

/** One eligible, over-threshold vendor's total for the year, boxed. */
export interface Vendor1099Row {
  companyId: string
  companyName: string
  /** `'none'` when the company has not been mapped to a box. */
  box: string
  totalMinor: number
  taxClassification: string | null
  tin: string | null
  w9OnFile: boolean
}

export interface Vendor1099Summary {
  organizationId: string
  year: number
  thresholdMinor: number
  rows: Vendor1099Row[]
  totalMinor: number
}

/** The 1099 summary's own columns - one "Total" value column. */
export const VENDOR_1099_COLUMNS: StatementColumn[] = [
  { key: 'total', label: 'Total', align: 'right' },
]

/** Box order the summary sections in - the same order `default1099Box`'s options are declared in. */
const BOX_ORDER = ['nec_1', 'misc_1_rents', 'misc_3_other', 'none'] as const

const BOX_LABELS: Record<string, string> = {
  nec_1: '1099-NEC Box 1 - Nonemployee compensation',
  misc_1_rents: '1099-MISC Box 1 - Rents',
  misc_3_other: '1099-MISC Box 3 - Other income',
  none: 'Unmapped',
}

/**
 * The summary as `StatementRow[]`: one section per 1099 box (in
 * {@link BOX_ORDER}, empty boxes omitted), each vendor a line, a subtotal per
 * box, and a grand total.
 */
export function toVendor1099Rows(summary: Vendor1099Summary): StatementRow[] {
  // No sections and no total, deliberately - a lone total row over nothing
  // would read as "$0 owed to a filed 1099", a different claim than "nothing
  // met the threshold this year".
  if (summary.rows.length === 0) return []

  const byBox = new Map<string, Vendor1099Row[]>()
  for (const row of summary.rows) {
    const bucket = byBox.get(row.box)
    if (bucket) bucket.push(row)
    else byBox.set(row.box, [row])
  }

  const sections: StatementRow[] = []
  for (const box of BOX_ORDER) {
    const boxRows = byBox.get(box)
    if (!boxRows || boxRows.length === 0) continue

    const children: StatementRow[] = boxRows.map((row) => ({
      id: row.companyId,
      label: row.companyName,
      depth: 1,
      kind: 'line',
      values: [row.totalMinor],
      meta: { recordId: row.companyId },
    }))
    const boxTotal = boxRows.reduce((sum, row) => sum + row.totalMinor, 0)
    children.push({
      id: `${box}:total`,
      label: `Total ${BOX_LABELS[box] ?? box}`,
      depth: 1,
      kind: 'subtotal',
      values: [boxTotal],
    })

    sections.push({
      id: box,
      label: BOX_LABELS[box] ?? box,
      depth: 0,
      kind: 'section',
      values: [boxTotal],
      children,
    })
  }

  sections.push(totalRow('grand-total', 'Total', [summary.totalMinor]))
  return sections
}

/** CSV export of the summary, ready for the year-end filing packet. */
export function toVendor1099CsvRows(summary: Vendor1099Summary): string {
  return toCsvRows(toVendor1099Rows(summary), VENDOR_1099_COLUMNS)
}
