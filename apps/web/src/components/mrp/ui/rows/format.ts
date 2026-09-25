// apps/web/src/components/mrp/ui/rows/format.ts

import { MRP_FLAG_LABELS, type MrpFlag } from '@auxx/lib/mrp/client'
import { StockStatus } from '@auxx/lib/resources/client'
import { format, parseISO } from 'date-fns'

const qty = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 })

/** A plan quantity, up to two decimals, grouped. */
export function formatQty(value: number): string {
  return qty.format(value)
}

/** A `YYYY-MM-DD` order-by as "Sep 26", with the year only when it is not `today`'s. */
export function formatOrderBy(day: string, today: Date = new Date()): string {
  const date = parseISO(day)
  return date.getFullYear() === today.getFullYear()
    ? format(date, 'MMM d')
    : format(date, "MMM d ''yy")
}

/** A flag's label; an unknown key reads as itself rather than disappearing. */
export function flagLabel(flag: string): string {
  return MRP_FLAG_LABELS[flag as MrpFlag] ?? flag
}

/** `draft_po_pending` is a fact about the row, shown as its own badge, not a warning. */
export function warningFlags(flags: readonly string[]): string[] {
  return flags.filter((flag) => flag !== 'draft_po_pending')
}

const DOT_BY_COLOR: Record<string, string> = {
  red: 'bg-red-500',
  amber: 'bg-amber-500',
  green: 'bg-green-500',
}

/** `part_stock_status`'s dot class and word, from the field's own option colours. */
export function stockStatusDisplay(status: string | null): { dot: string; label: string } | null {
  const option = StockStatus.values.find((value) => value.value === status)
  if (!option) return null
  return {
    dot: DOT_BY_COLOR[option.color] ?? 'bg-muted-foreground',
    label: option.label.toLowerCase(),
  }
}
