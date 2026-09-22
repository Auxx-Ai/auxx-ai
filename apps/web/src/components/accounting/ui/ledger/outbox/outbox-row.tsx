// apps/web/src/components/accounting/ui/ledger/outbox/outbox-row.tsx

'use client'

import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { PanelRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { useBulkMode, useIsSelected, useListSelection } from '~/components/list-selection'
import { recordBadgeVariants } from '~/components/resources/ui/record-badge'

interface OutboxRowProps {
  id: string
  icon?: ReactNode
  /** Already formatted; width-pinned so every row's label starts at the same x. */
  date: string
  /**
   * What kind of thing this row is, already labelled. Each tab reads it off a
   * different vocabulary - posting type, movement purpose, provider object -
   * and they share the column so one tab's rows scan like the next one's.
   */
  typeLabel?: string
  title: ReactNode
  secondary?: ReactNode
  /** The help-icon tooltip beside the title - the place for a sentence too long for the line. */
  description?: string
  /** Already formatted. */
  amount: string
  /** Badges and buttons after the amount; every row on a tab renders the same set so the column aligns. */
  actions?: ReactNode
  /** Opens the `?posting=` drawer - the trailing button, and the row click when nothing else takes it. */
  onOpen?: () => void
  /** The row the drawer is showing. */
  active?: boolean
  /** A hover-revealed checkbox on every row; off for a child row that is not its own item. */
  selectable?: boolean
  selectLabel: string
  depth?: number
  expandable?: boolean
  isOpen?: boolean
  onToggleOpen?: () => void
  /** Split the two gestures: the body does this, the chevron still expands. */
  onRowClick?: () => void
  children?: ReactNode
}

/**
 * One Outbox row, whichever tab: date, label, amount, then the same buttons on
 * every row. Selection is the outbox's `ListSelectionProvider` - while picking,
 * a row click extends the selection rather than opening anything (the review
 * queue's rule).
 */
export function OutboxRow({
  id,
  icon,
  date,
  typeLabel,
  title,
  secondary,
  description,
  amount,
  actions,
  onOpen,
  active = false,
  selectable = true,
  selectLabel,
  depth,
  expandable = false,
  isOpen,
  onToggleOpen,
  onRowClick,
  children,
}: OutboxRowProps) {
  const selecting = useBulkMode()
  const selected = useIsSelected(id)
  const toggle = useListSelection((state) => state.toggle)
  const picking = selectable && selecting

  return (
    // No `TREE_SECONDARY_NOTRUNCATE` here: the secondary is the slot that must
    // yield when the drawer takes width, and it sheds whole badges instead (83 §2.1).
    <TreeRow
      depth={depth}
      icon={icon}
      expandable={expandable}
      isOpen={isOpen}
      selectable={selectable}
      selecting={picking}
      selected={selected}
      onSelectChange={(_next, event) => toggle(id, { shiftKey: event.shiftKey })}
      selectLabel={selectLabel}
      onToggleOpen={picking ? () => toggle(id) : (onToggleOpen ?? onOpen)}
      // While picking, a row click extends the selection and nothing else.
      onRowClick={picking ? undefined : onRowClick}
      description={description}
      title={
        <span className='flex min-w-0 items-center gap-1.5'>
          <span className='w-24 shrink-0 font-mono text-muted-foreground text-xs tabular-nums'>
            {date}
          </span>
          {/* The CELL is pinned - held open on a child row too, so the title
              column starts at the same x whether or not this row names a type.
              The badge inside it sizes to its text, like every RecordBadge. */}
          <span className='w-32 shrink-0'>
            {typeLabel && (
              <span
                className={cn(
                  recordBadgeVariants({ size: 'sm' }),
                  // `ps-0.5 pe-1` is tuned for a badge that leads with an icon.
                  'w-fit max-w-full px-1.5'
                )}>
                <span className='truncate'>{typeLabel}</span>
              </span>
            )}
          </span>
          {/* A floor, so the memo never collapses to `C...` while the badges keep every pixel. */}
          <span className='min-w-40 truncate text-sm'>{title}</span>
        </span>
      }
      secondary={secondary}
      actions={
        <div className='flex shrink-0 items-center gap-2'>
          <span className='font-mono text-xs tabular-nums'>{amount}</span>
          {actions}
          {onOpen && (
            <TreeRowButton persistent tooltipText='Open details' onClick={onOpen}>
              <PanelRight />
            </TreeRowButton>
          )}
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
      )}>
      {children}
    </TreeRow>
  )
}
