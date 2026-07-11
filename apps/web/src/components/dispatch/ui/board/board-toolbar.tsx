// apps/web/src/components/dispatch/ui/board/board-toolbar.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { endOfWeek, format, startOfWeek } from 'date-fns'
import { CalendarDays, CalendarRange, ChevronLeft, ChevronRight, PanelLeft } from 'lucide-react'
import { DateTimePicker } from '~/components/pickers/date-time-picker'
import type { BoardViewMode, BoardWorker } from './types'
import { goToNextDate, goToPreviousDate, viewedMonthStart, type WeekStartIndex } from './utils'
import { WorkerFilterPopover } from './worker-filter-popover'

interface BoardToolbarProps {
  date: Date
  onDateChange: (date: Date) => void
  view: BoardViewMode
  onViewChange: (view: BoardViewMode) => void
  weekStartsOn: WeekStartIndex
  workers: BoardWorker[]
  selectedWorkerIds: Set<string> | null
  onSelectedWorkerIdsChange: (ids: Set<string> | null) => void
  showBacklog: boolean
  onShowBacklogChange: (show: boolean) => void
}

/** View-shaped date label: month → "August 2026", week → short from–to, day → full date. */
function dateLabel(view: BoardViewMode, date: Date, weekStartsOn: WeekStartIndex): string {
  if (view === 'month') return format(viewedMonthStart(date, weekStartsOn), 'MMMM yyyy')
  if (view === 'week') {
    const start = startOfWeek(date, { weekStartsOn })
    const end = endOfWeek(date, { weekStartsOn })
    if (start.getFullYear() !== end.getFullYear())
      return `${format(start, 'MMM d, yyyy')} – ${format(end, 'MMM d, yyyy')}`
    if (start.getMonth() !== end.getMonth())
      return `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`
    return `${format(start, 'MMM d')} – ${format(end, 'd, yyyy')}`
  }
  return format(date, 'PPP')
}

/**
 * Board toolbar (07 §D.2): date nav, Day/Week/Month `RadioTab`, the day-view worker filter,
 * and the backlog-rail toggle. A board↔map toggle slot is reserved for M3 (04-ui #10).
 */
export function BoardToolbar({
  date,
  onDateChange,
  view,
  onViewChange,
  weekStartsOn,
  workers,
  selectedWorkerIds,
  onSelectedWorkerIdsChange,
  showBacklog,
  onShowBacklogChange,
}: BoardToolbarProps) {
  return (
    <div className='flex flex-wrap items-center gap-2 border-b p-2'>
      <Button variant='outline' size='sm' onClick={() => onShowBacklogChange(!showBacklog)}>
        <PanelLeft />
      </Button>

      <div className='flex items-center gap-1'>
        <Button variant='outline' size='sm' onClick={() => onDateChange(new Date())}>
          Today
        </Button>
        <Button
          variant='ghost'
          size='icon'
          onClick={() => onDateChange(goToPreviousDate(view, date, weekStartsOn))}
          aria-label='Previous'>
          <ChevronLeft />
        </Button>
        <Button
          variant='ghost'
          size='icon'
          onClick={() => onDateChange(goToNextDate(view, date, weekStartsOn))}
          aria-label='Next'>
          <ChevronRight />
        </Button>
        <DateTimePicker
          value={date}
          onChange={(value) => value && onDateChange(value)}
          mode='date'
          notClearable>
          <Button variant='ghost' size='sm'>
            {dateLabel(view, date, weekStartsOn)}
          </Button>
        </DateTimePicker>
      </div>

      <RadioTab value={view} onValueChange={(v) => onViewChange(v as BoardViewMode)} size='sm'>
        <RadioTabItem value='day' size='sm' tooltip='Day'>
          <CalendarDays />
          <span className='hidden sm:inline'>Day</span>
        </RadioTabItem>
        <RadioTabItem value='week' size='sm' tooltip='Week'>
          <CalendarRange />
          <span className='hidden sm:inline'>Week</span>
        </RadioTabItem>
        <RadioTabItem value='month' size='sm' tooltip='Month'>
          <CalendarDays />
          <span className='hidden sm:inline'>Month</span>
        </RadioTabItem>
      </RadioTab>

      {view === 'day' && (
        <WorkerFilterPopover
          workers={workers}
          selectedWorkerIds={selectedWorkerIds}
          onChange={onSelectedWorkerIdsChange}
        />
      )}

      {/* M3: board ↔ map toggle slot (04-ui #10, live worker/visit pins). */}

      <div className='flex-1' />
    </div>
  )
}
