// apps/web/src/components/mrp/ui/rows/group-row.tsx

'use client'

import { TreeRow } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import type { ReactNode } from 'react'
import { useBulkMode, useListSelection, useSelectionIds } from '~/components/list-selection'

export interface GroupRowProps {
  icon: ReactNode
  label: string
  /** Already formatted, e.g. `4 parts`. */
  count: string
  /** Already formatted; the group's summed figure in `actions`. */
  total?: string
  /** The help-icon tooltip beside the label. */
  description?: string
  /** Buttons after the total, e.g. a per-group action. */
  actions?: ReactNode
  /** The selection ids under this header; its checkbox selects or clears them all. */
  itemIds: string[]
  open: boolean
  onToggle: () => void
  children: ReactNode
}

/** A group header over nested rows: its hover checkbox takes the whole group. Shared by the outbox and MRP lists. */
export function GroupRow({
  icon,
  label,
  count,
  total,
  description,
  actions,
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
      description={description}
      title={<span className='truncate font-medium text-sm'>{label}</span>}
      secondary={<span className='text-muted-foreground text-xs'>{count}</span>}
      actions={
        actions ? (
          <div className='flex shrink-0 items-center gap-2'>
            {total !== undefined && <span className='font-mono text-xs tabular-nums'>{total}</span>}
            {actions}
          </div>
        ) : (
          total !== undefined && <span className='font-mono text-xs tabular-nums'>{total}</span>
        )
      }
      rowClassName={cn(
        'bg-primary-100/50 hover:bg-primary-100',
        all && 'bg-info/10 hover:bg-info/15 dark:bg-info/20 dark:hover:bg-info/25'
      )}>
      {children}
    </TreeRow>
  )
}
