// apps/web/src/components/accounting/ui/ledger/outbox/group-row.tsx

'use client'

import { TreeRow } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { useBulkMode, useListSelection, useSelectionIds } from '~/components/list-selection'
import { EMPTY_CELL, formatAccountingDate, formatMinor, formatShortPeriodLabel } from '../format'

interface GroupRowProps {
  icon: React.ReactNode
  label: string
  count: string
  total: string
  /** The selection ids under this header; its checkbox selects or clears them all. */
  itemIds: string[]
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}

/** A group header over nested rows, the deposits list's shape: its hover checkbox takes the whole group. */
export function GroupRow({
  icon,
  label,
  count,
  total,
  itemIds,
  open,
  onToggle,
  children,
}: GroupRowProps) {
  const selecting = useBulkMode()
  const selectedIds = useSelectionIds()
  const toggleMany = useListSelection((state) => state.toggleMany)
  const picked = itemIds.filter((id) => selectedIds.includes(id)).length
  const all = itemIds.length > 0 && picked === itemIds.length
  return (
    <TreeRow
      icon={icon}
      expandable
      isOpen={open}
      onToggleOpen={onToggle}
      selectable
      selecting={selecting}
      selected={all ? true : picked > 0 ? 'indeterminate' : false}
      onSelectChange={(next) => toggleMany(itemIds, next)}
      selectLabel={`Select every row of ${label}`}
      title={<span className='truncate font-medium text-sm'>{label}</span>}
      secondary={<span className='text-muted-foreground text-xs'>{count}</span>}
      actions={<span className='font-mono text-xs tabular-nums'>{total}</span>}
      rowClassName={cn(
        'bg-primary-100/50 hover:bg-primary-100',
        all && 'bg-info/10 hover:bg-info/15 dark:bg-info/20 dark:hover:bg-info/25'
      )}>
      {children}
    </TreeRow>
  )
}

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
