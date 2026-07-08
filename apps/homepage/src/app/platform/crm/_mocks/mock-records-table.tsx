// apps/homepage/src/app/platform/crm/_mocks/mock-records-table.tsx

import { ChevronDown, Columns3, ListFilter, MoreHorizontal, Search, Upload } from 'lucide-react'
import { ENTITY_COLOR_CLASS } from '~/app/platform/ai/_mocks'
import { cn } from '~/lib/utils'
import { type MockCell, type MockColumn, nameInitials, type PersonaConfig } from './personas'

const HIDE_CLASS: Record<NonNullable<MockColumn['hide']>, string> = {
  md: 'hidden md:flex',
  lg: 'hidden lg:flex',
}

/**
 * Static facsimile of the records DynamicTable (styling reference:
 * `/app/tickets`), driven by a persona config — toolbar, typed column
 * headers, and cell kinds (name avatars, entity badges, status pills).
 */
export function MockRecordsTable({
  persona,
  className,
}: {
  persona: PersonaConfig
  className?: string
}) {
  return (
    <div
      className={cn(
        'relative flex h-full min-h-0 flex-1 flex-col bg-mock-window text-mock-window-foreground',
        className
      )}>
      <Toolbar viewLabel={persona.viewLabel} />
      <div
        className={cn(
          persona.gridCols,
          'h-8 items-center border-y border-mock-window-border text-xs'
        )}>
        <div className='flex items-center justify-center'>
          <Checkbox />
        </div>
        {persona.columns.map((column) => {
          const Icon = column.icon
          return (
            <div
              key={column.label}
              className={cn(
                'flex items-center gap-1.5 px-2 text-mock-window-muted',
                column.hide && HIDE_CLASS[column.hide]
              )}>
              <Icon className='size-3 shrink-0' />
              <span className='truncate'>{column.label}</span>
            </div>
          )
        })}
      </div>
      <div className='min-h-0 flex-1 overflow-hidden'>
        {persona.rows.map((row, rowIndex) => (
          <div
            key={rowIndex}
            className={cn(
              persona.gridCols,
              'h-9 items-center border-b border-mock-window-border/60 text-xs'
            )}>
            <div className='flex items-center justify-center'>
              <Checkbox />
            </div>
            {row.map((cell, cellIndex) => (
              <CellView key={cellIndex} cell={cell} hide={persona.columns[cellIndex]?.hide} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function Toolbar({ viewLabel }: { viewLabel: string }) {
  return (
    <div className='flex items-center gap-2 px-3 py-2 text-xs'>
      <span className='flex shrink-0 items-center gap-1 rounded-md border border-mock-window-border px-2 py-1 font-medium'>
        {viewLabel}
        <ChevronDown className='size-3 text-mock-window-muted' />
      </span>
      <MoreHorizontal className='size-3.5 shrink-0 text-mock-window-muted' />
      <span className='hidden shrink-0 items-center gap-1.5 px-1 text-mock-window-muted sm:flex'>
        <ListFilter className='size-3.5' />
        Filter
      </span>
      <span className='hidden shrink-0 items-center gap-1.5 px-1 text-mock-window-muted md:flex'>
        <Columns3 className='size-3.5' />
        Columns
      </span>
      <span className='hidden shrink-0 items-center gap-1.5 px-1 text-mock-window-muted md:flex'>
        <Upload className='size-3.5' />
        Import / Export
      </span>
      <span className='ml-2 flex min-w-0 flex-1 items-center gap-2 rounded-md border border-mock-window-border px-2 py-1 text-mock-window-muted'>
        <Search className='size-3.5 shrink-0' />
        <span className='truncate'>Search records...</span>
      </span>
    </div>
  )
}

function CellView({ cell, hide }: { cell: MockCell; hide?: MockColumn['hide'] }) {
  const hideClass = hide && HIDE_CLASS[hide]

  switch (cell.kind) {
    case 'text':
      return (
        <div
          className={cn(
            'truncate px-2',
            cell.muted && 'text-mock-window-muted',
            hide ? cn('hidden', hide === 'md' ? 'md:block' : 'lg:block') : undefined
          )}>
          {cell.label}
        </div>
      )
    case 'name':
      return (
        <div className={cn('flex min-w-0 items-center gap-2 px-2', hideClass)}>
          <span className='flex size-5 shrink-0 items-center justify-center rounded-full bg-blue-500 text-[9px] font-semibold text-blue-50'>
            {nameInitials(cell.label)}
          </span>
          <span className='truncate font-medium'>{cell.label}</span>
        </div>
      )
    case 'record': {
      const Icon = cell.icon
      return (
        <div className={cn('flex min-w-0 items-center gap-1.5 px-2', hideClass)}>
          <span
            className={cn(
              'flex size-4 shrink-0 items-center justify-center rounded',
              ENTITY_COLOR_CLASS[cell.color]
            )}>
            <Icon className='size-2.5' />
          </span>
          <span className='truncate'>{cell.label}</span>
        </div>
      )
    }
    case 'pill':
      return (
        <div
          className={cn(
            'min-w-0 px-2',
            hide ? cn('hidden', hide === 'md' ? 'md:block' : 'lg:block') : undefined
          )}>
          <span
            className={cn(
              'inline-block max-w-full truncate rounded-full px-1.5 py-0.5 text-[10px] font-medium',
              cell.className
            )}>
            {cell.label}
          </span>
        </div>
      )
  }
}

function Checkbox() {
  return <span className='size-3.5 rounded border border-mock-window-border' />
}
