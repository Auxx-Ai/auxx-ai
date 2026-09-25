// apps/web/src/components/mrp/ui/rows/mrp-row.tsx

'use client'

import { MRP_SUGGESTION_KIND_LABELS } from '@auxx/lib/mrp/client'
import { Badge } from '@auxx/ui/components/badge'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { Flag, Package, PanelRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { EMPTY_CELL } from '~/components/global/module-toolbar'
import { useBulkMode, useIsSelected, useListSelection } from '~/components/list-selection'
import { recordBadgeVariants } from '~/components/resources/ui/record-badge'
import type { RouterOutputs } from '~/trpc/react'
import { flagLabel, formatOrderBy, formatQty, stockStatusDisplay, warningFlags } from './format'

/** One `mrp.list` item. */
export type MrpListRow = RouterOutputs['mrp']['list']['items'][number]

export interface MrpRowProps {
  item: MrpListRow
  /** Opens the part in the docked drawer; the trailing button, and the row click when not picking. */
  onOpen: (partId: string) => void
  /** The row the drawer is showing. */
  active?: boolean
  depth?: number
  /** Off for a row that is context, not its own pickable item. Default true. */
  selectable?: boolean
  /** Extra controls before the open button, e.g. a flag's door on the Flags page. */
  actions?: ReactNode
}

/** One part in an MRP list (07 §4.1): order-by, kind, name; supplier and warnings; quantity and status. Selection id is `partId`. */
export function MrpRow({
  item,
  onOpen,
  active = false,
  depth,
  selectable = true,
  actions,
}: MrpRowProps) {
  const selecting = useBulkMode()
  const selected = useIsSelected(item.partId)
  const toggle = useListSelection((state) => state.toggle)
  const picking = selectable && selecting
  const name = item.partName ?? 'Unnamed part'
  const open = () => onOpen(item.partId)

  const flags = warningFlags(item.flags)
  const draftPending = item.flags.includes('draft_po_pending')
  const status = stockStatusDisplay(item.stockStatus)
  const packs =
    item.suggestedPurchaseUnits !== null &&
    item.suggestedQty !== null &&
    item.suggestedPurchaseUnits !== item.suggestedQty
      ? `${formatQty(item.suggestedPurchaseUnits)} purchase units`
      : null

  return (
    <TreeRow
      depth={depth}
      icon={<Package className='size-4 text-muted-foreground' />}
      selectable={selectable}
      selecting={picking}
      selected={selected}
      onSelectChange={(_next, event) => toggle(item.partId, { shiftKey: event.shiftKey })}
      selectLabel={`Select ${name}`}
      // While picking, a row click extends the selection and nothing else.
      onToggleOpen={picking ? () => toggle(item.partId) : open}
      description={item.partSku ?? undefined}
      title={
        <span className='flex min-w-0 items-center gap-1.5'>
          <span
            className={cn(
              'w-20 shrink-0 font-mono text-xs tabular-nums',
              item.isOverdue ? 'text-destructive' : 'text-muted-foreground'
            )}>
            {item.isOverdue
              ? 'overdue'
              : item.orderByDate
                ? formatOrderBy(item.orderByDate)
                : EMPTY_CELL}
          </span>
          {/* Held open when empty so the name starts at one x on every row. */}
          <span className='w-24 shrink-0'>
            {item.suggestionKind && (
              <span className={cn(recordBadgeVariants({ size: 'sm' }), 'w-fit max-w-full px-1.5')}>
                <span className='truncate'>{MRP_SUGGESTION_KIND_LABELS[item.suggestionKind]}</span>
              </span>
            )}
          </span>
          <span className='truncate text-sm'>{name}</span>
        </span>
      }
      secondary={
        <span className='flex flex-wrap items-center gap-1.5'>
          {item.supplierName && (
            <Badge variant='outline' size='xs'>
              {item.supplierName}
            </Badge>
          )}
          {item.daysOfCover !== null && (
            <span className='text-muted-foreground text-xs tabular-nums'>
              {item.daysOfCover} d cover
            </span>
          )}
          {flags.length > 0 && (
            <SimpleTooltip content={flags.map(flagLabel).join(' · ')}>
              <Badge variant='amber' size='xs'>
                <Flag />
                {flags.length}
              </Badge>
            </SimpleTooltip>
          )}
          {draftPending && (
            <Badge variant='outline' size='xs'>
              draft pending
            </Badge>
          )}
        </span>
      }
      actions={
        <div className='flex shrink-0 items-center gap-2'>
          {packs ? (
            <SimpleTooltip content={packs}>
              <span className='font-mono text-xs tabular-nums'>
                {formatQty(item.suggestedQty ?? 0)}
              </span>
            </SimpleTooltip>
          ) : (
            <span className='font-mono text-xs tabular-nums'>
              {item.suggestedQty !== null ? formatQty(item.suggestedQty) : EMPTY_CELL}
            </span>
          )}
          <span className='flex w-24 items-center gap-1 text-muted-foreground text-xs'>
            {status ? (
              <>
                <span className={cn('size-1.5 shrink-0 rounded-full', status.dot)} aria-hidden />
                <span className='truncate'>{status.label}</span>
              </>
            ) : (
              EMPTY_CELL
            )}
          </span>
          {actions}
          <TreeRowButton persistent tooltipText='Open details' onClick={open}>
            <PanelRight />
          </TreeRowButton>
        </div>
      }
      // `info` is what a picked row wears, `primary-*` the row you are looking at.
      rowClassName={cn(
        'bg-primary-100/50 hover:bg-primary-100',
        active && 'bg-primary-100 ring-1 ring-primary-200',
        selected &&
          cn(
            'bg-info/10 hover:bg-info/15 dark:bg-info/20 dark:hover:bg-info/25',
            active && 'ring-info/40'
          )
      )}
    />
  )
}
