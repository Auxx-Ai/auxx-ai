// apps/web/src/components/dynamic-table/components/group-add-row.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import type { Table } from '@tanstack/react-table'
import type { VirtualItem, Virtualizer } from '@tanstack/react-virtual'
import { Plus } from 'lucide-react'
import { useViewMetadata } from '../context/view-metadata-context'
import type { GroupingProps } from '../types'
import { ADD_ROW_HEIGHT } from '../utils/constants'
import { GroupRowFrame } from './group-header-row'

interface GroupAddRowProps<TData> {
  table: Table<TData>
  groupKey: string | null
  grouping: GroupingProps
  virtualRow: VirtualItem
  rowVirtualizer: Virtualizer<HTMLDivElement, Element>
}

/** "+ New {entity}" closing an expanded group; prefills the group field. */
export function GroupAddRow<TData>({
  table,
  groupKey,
  grouping,
  virtualRow,
  rowVirtualizer,
}: GroupAddRowProps<TData>) {
  const { onAddNew, entityLabel } = useViewMetadata<TData>()
  if (!onAddNew) return null

  return (
    <GroupRowFrame
      table={table}
      virtualRow={virtualRow}
      rowVirtualizer={rowVirtualizer}
      height={ADD_ROW_HEIGHT}
      cellClassName='bg-primary-50/80 dark:bg-background'
      renderCell={(_column, isPrimary) =>
        isPrimary ? (
          <Button
            variant='ghost'
            size='xs'
            className='ml-1.5 text-muted-foreground'
            onClick={() => onAddNew(grouping.presetForKey?.(groupKey))}>
            <Plus />
            New {entityLabel ?? 'record'}
          </Button>
        ) : null
      }
    />
  )
}
