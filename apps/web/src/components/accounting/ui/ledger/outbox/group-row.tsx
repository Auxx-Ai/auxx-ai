// apps/web/src/components/accounting/ui/ledger/outbox/group-row.tsx

'use client'

import { EMPTY_CELL } from '~/components/global/module-toolbar'
import { formatAccountingDate, formatMinor, formatShortPeriodLabel } from '../format'

// The header row moved beside the MRP rows, its second consumer.
export { GroupRow } from '~/components/mrp/ui/rows/group-row'

/** A `YYYY-MM` key reads as its period, a `YYYY-MM-DD` key as its date. */
export function dayKeyLabel(dayKey: string | null | undefined, bookTimeZone: string): string {
  if (!dayKey) return EMPTY_CELL
  if (/^\d{4}-\d{2}$/.test(dayKey)) return formatShortPeriodLabel(dayKey)
  return formatAccountingDate(dayKey, bookTimeZone)
}

/** One figure per currency, so a mixed day is not summed across currencies. */
export function totalsLabel(rows: ReadonlyArray<{ totalMinor: number; currency: string }>): string {
  const byCurrency = new Map<string, number>()
  for (const row of rows)
    byCurrency.set(row.currency, (byCurrency.get(row.currency) ?? 0) + row.totalMinor)
  return [...byCurrency.entries()]
    .map(([currency, total]) => formatMinor(total, currency))
    .join(' · ')
}

/** Consecutive rows sharing a day key, in the order given - the server's order, never re-sorted. */
export function groupConsecutiveByDay<T extends { dayKey: string | null }>(
  rows: readonly T[]
): Array<{ key: string; rows: T[] }> {
  const groups: Array<{ key: string; rows: T[] }> = []
  for (const row of rows) {
    const key = row.dayKey ?? ''
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.rows.push(row)
    else groups.push({ key, rows: [row] })
  }
  return groups
}
