// apps/web/src/components/dynamic-table/components/summarize-menu.tsx
'use client'

import { COLUMN_AGGREGATE_OPS } from '@auxx/lib/resources/grouping/client'
import { Button } from '@auxx/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@auxx/ui/components/dropdown-menu'
import { cn } from '@auxx/ui/lib/utils'
import { Sigma } from 'lucide-react'
import { useSetColumnAggregate } from '../stores/store-actions'
import { useColumnAggregates } from '../stores/store-selectors'
import type { ColumnAggregateOp } from '../types'

const NONE = 'none'

interface SummarizeMenuProps {
  tableId: string
  columnId: string
}

/** None / Sum / Average / Min / Max radio items writing the column's aggregate op. */
function SummarizeMenuItems({ tableId, columnId }: SummarizeMenuProps) {
  const current = useColumnAggregates(tableId)[columnId]
  const setColumnAggregate = useSetColumnAggregate(tableId)

  return (
    <DropdownMenuRadioGroup
      value={current ?? NONE}
      onValueChange={(value) =>
        setColumnAggregate(columnId, value === NONE ? null : (value as ColumnAggregateOp))
      }>
      <DropdownMenuRadioItem value={NONE}>None</DropdownMenuRadioItem>
      {COLUMN_AGGREGATE_OPS.map((op) => (
        <DropdownMenuRadioItem key={op.value} value={op.value}>
          {op.label}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  )
}

/** "Summarize" submenu for the column header menu. */
export function SummarizeSubMenu(props: SummarizeMenuProps) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Sigma />
        Summarize
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <SummarizeMenuItems {...props} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

/** Hover-only "Σ" affordance in a group header cell; opens the same menu as the column header. */
export function SummarizeGhostButton({
  className,
  ...props
}: SummarizeMenuProps & { className?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant='ghost'
          size='icon-xs'
          className={cn('text-muted-foreground', className)}
          aria-label='Summarize column'>
          <Sigma />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='w-[160px]'>
        <SummarizeMenuItems {...props} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
