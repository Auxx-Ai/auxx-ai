// apps/web/src/components/kopilot/ui/blocks/table-block.tsx

'use client'

import { getOptionColor } from '@auxx/lib/custom-fields/client'
import type { RecordId } from '@auxx/lib/resources/client'
import type { SelectOptionColor } from '@auxx/types/custom-field'
import { Dialog, DialogContent, DialogTitle } from '@auxx/ui/components/dialog'
import { ScrollArea } from '@auxx/ui/components/scroll-area'
import { VisuallyHidden } from '@auxx/ui/components/visually-hidden'
import { cn } from '@auxx/ui/lib/utils'
import { format, formatDistanceToNow } from 'date-fns'
import { Maximize2, Minimize2 } from 'lucide-react'
import { useState } from 'react'
import { Tooltip } from '~/components/global/tooltip'
import { ActorBadge } from '~/components/resources/ui/actor-badge'
import { RecordBadge } from '~/components/resources/ui/record-badge'
import { ActionButton } from '~/components/workflow/ui/action-button'
import { BlockCard } from './block-card'
import type { BlockRendererProps } from './block-registry'
import type { TableBlockData, TableCellData, TableColumnData } from './block-schemas'

function CellContent({ cell }: { cell: TableCellData }) {
  // Entity record link
  if (cell.recordId) {
    return (
      <div className='inline-flex'>
        <RecordBadge recordId={cell.recordId as RecordId} variant='link' link />
      </div>
    )
  }

  // Actor badge
  if (cell.actorId) {
    return (
      <div className='inline-flex'>
        <ActorBadge actorId={cell.actorId as `${string}:${string}`} size='sm' />
      </div>
    )
  }

  // Tags / select badges
  if (cell.type === 'tags' && cell.tags?.length) {
    return (
      <div className='flex flex-wrap gap-1'>
        {cell.tags.map((tag, i) => {
          const colorConfig = getOptionColor((tag.color ?? 'gray') as SelectOptionColor)
          return (
            <span
              key={i}
              className={cn(
                'inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ring-black/10',
                colorConfig.badgeClasses
              )}>
              {tag.label}
            </span>
          )
        })}
      </div>
    )
  }

  // Date — relative with absolute tooltip
  if (cell.type === 'date') {
    const date = new Date(cell.text)
    if (!Number.isNaN(date.getTime())) {
      return (
        <Tooltip content={format(date, 'PPpp')}>
          <span className='cursor-default whitespace-nowrap text-muted-foreground'>
            {formatDistanceToNow(date, { addSuffix: true })}
          </span>
        </Tooltip>
      )
    }
  }

  // Email — clickable mailto
  if (cell.type === 'email') {
    return (
      <a
        href={`mailto:${cell.text}`}
        className='text-primary hover:underline'
        onClick={(e) => e.stopPropagation()}>
        {cell.text}
      </a>
    )
  }

  // Phone — clickable tel
  if (cell.type === 'phone') {
    return (
      <a
        href={`tel:${cell.text}`}
        className='text-primary hover:underline'
        onClick={(e) => e.stopPropagation()}>
        {cell.text}
      </a>
    )
  }

  // External link
  if (cell.href) {
    return (
      <a
        href={cell.href}
        target='_blank'
        rel='noopener noreferrer'
        className='text-primary hover:underline'
        onClick={(e) => e.stopPropagation()}>
        {cell.text}
      </a>
    )
  }

  // Date auto-detection fallback (ISO timestamps without explicit type hint)
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(cell.text)) {
    const date = new Date(cell.text)
    if (!Number.isNaN(date.getTime())) {
      return (
        <Tooltip content={format(date, 'PPpp')}>
          <span className='cursor-default whitespace-nowrap text-muted-foreground'>
            {formatDistanceToNow(date, { addSuffix: true })}
          </span>
        </Tooltip>
      )
    }
  }

  // Plain text fallback
  return <>{cell.text}</>
}

/** Derive column alignment: explicit align takes precedence, then auto-right-align numeric columns */
function getColumnAlign(
  columns: TableColumnData[],
  rows: TableCellData[][],
  colIdx: number
): string {
  if (columns[colIdx]?.align) return columns[colIdx].align!
  const allNumeric = rows.every((row) => {
    const cell = row[colIdx]
    return cell?.type === 'currency' || cell?.type === 'number'
  })
  return allNumeric ? 'right' : 'left'
}

function TableContent({ columns, rows }: { columns: TableColumnData[]; rows: TableCellData[][] }) {
  return (
    <table className='w-full text-sm' style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
      <thead>
        <tr>
          {columns.map((col, i) => (
            <th
              key={i}
              className={cn(
                'text-muted-foreground whitespace-nowrap border-b bg-muted px-3 py-2 font-medium',
                'sticky top-0 z-10',
                i === 0 && 'left-0 z-20 rounded-tl-2xl shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]',
                i === columns.length - 1 && 'rounded-tr-2xl'
              )}
              style={{ textAlign: getColumnAlign(columns, rows, i) }}>
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIdx) => (
          <tr key={rowIdx} className='hover:bg-muted/30 transition-colors'>
            {row.map((cell, colIdx) => (
              <td
                key={colIdx}
                className={cn(
                  'max-w-[280px] break-words px-3 py-2 align-top',
                  rowIdx < rows.length - 1 && 'border-b',
                  colIdx === 0 &&
                    'sticky left-0 z-10 bg-card shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]',
                  rowIdx === rows.length - 1 && colIdx === 0 && 'rounded-bl-2xl',
                  rowIdx === rows.length - 1 && colIdx === row.length - 1 && 'rounded-br-2xl'
                )}
                style={{ textAlign: getColumnAlign(columns, rows, colIdx) }}>
                <CellContent cell={cell} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ExpandButton({
  isExpanded,
  onExpandChange,
}: {
  isExpanded: boolean
  onExpandChange: (expanded: boolean) => void
}) {
  return (
    <Tooltip content={isExpanded ? 'Close' : 'Expand'}>
      <div>
        <ActionButton onClick={() => onExpandChange(!isExpanded)}>
          {isExpanded ? <Minimize2 className='size-3.5' /> : <Maximize2 className='size-3.5' />}
        </ActionButton>
      </div>
    </Tooltip>
  )
}

export function TableBlock({ data }: BlockRendererProps<TableBlockData>) {
  const { columns, rows } = data
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <div className='not-prose my-2'>
      <BlockCard
        primaryText='Table'
        hasFooter={false}
        secondaryText={
          <span className='flex items-center gap-1.5'>
            <span className='text-xs text-muted-foreground'>
              {rows.length} {rows.length === 1 ? 'row' : 'rows'}
            </span>
            <ExpandButton isExpanded={false} onExpandChange={setIsExpanded} />
          </span>
        }>
        <ScrollArea
          orientation='horizontal'
          allowScrollChaining
          className='overflow-hidden rounded-xl'>
          <div className='pb-2'>
            <TableContent columns={columns} rows={rows} />
          </div>
        </ScrollArea>
      </BlockCard>

      <Dialog open={isExpanded} onOpenChange={setIsExpanded}>
        <DialogContent size='3xl' innerClassName='h-[80vh] flex flex-col p-0' showClose={false}>
          <VisuallyHidden>
            <DialogTitle>Table</DialogTitle>
          </VisuallyHidden>
          <div className='flex shrink-0 items-center justify-between border-b px-4 py-3'>
            <span className='text-xs font-semibold text-foreground/90'>Table</span>
            <span className='flex items-center gap-1.5'>
              <span className='text-xs text-muted-foreground'>
                {rows.length} {rows.length === 1 ? 'row' : 'rows'}
              </span>
              <ExpandButton isExpanded={true} onExpandChange={setIsExpanded} />
            </span>
          </div>
          <div className='min-h-0 flex-1 overflow-hidden'>
            <ScrollArea orientation='both' className='h-full'>
              <div className='pb-2'>
                <TableContent columns={columns} rows={rows} />
              </div>
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
