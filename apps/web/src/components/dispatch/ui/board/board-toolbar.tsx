// apps/web/src/components/dispatch/ui/board/board-toolbar.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { endOfWeek, format, startOfWeek } from 'date-fns'
import {
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Map as MapIcon,
  PanelLeft,
} from 'lucide-react'
import { DateTimePicker } from '~/components/pickers/date-time-picker'
import { TagFilterPopover } from '../route-planner/tag-filter-popover'
import type { BoardViewMode, BoardWorker } from './types'
import { goToNextDate, goToPreviousDate, viewedMonthStart, type WeekStartIndex } from './utils'
import { WorkerFilterPopover } from './worker-filter-popover'

export type BoardMode = 'calendar' | 'map'

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
  boardMode: BoardMode
  onBoardModeChange: (mode: BoardMode) => void
  /** Distinct `work_order.tags` across the route planner's visible day (map mode only). */
  tags: string[]
  selectedTags: Set<string> | null
  onSelectedTagsChange: (tags: Set<string> | null) => void
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
 * Board toolbar (07 §D.2, extended by 09-route-planner.md §A): date nav, Day/Week/Month
 * `RadioTab`, the day-view worker filter, the backlog-rail toggle, and the Board↔Map segmented
 * control. Map mode hides the Day/Week/Month switch (route planning is single-day), always
 * shows the worker filter, and adds the tag/region filter next to it.
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
  boardMode,
  onBoardModeChange,
  tags,
  selectedTags,
  onSelectedTagsChange,
}: BoardToolbarProps) {
  // Map mode is always a single day (route planning is inherently day-scoped, contract item 7)
  // regardless of whatever Day/Week/Month `view` the calendar was last left on — date nav and
  // the label both step/format as a day while map mode is active.
  const effectiveView: BoardViewMode = boardMode === 'map' ? 'day' : view

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
          onClick={() => onDateChange(goToPreviousDate(effectiveView, date, weekStartsOn))}
          aria-label='Previous'>
          <ChevronLeft />
        </Button>
        <Button
          variant='ghost'
          size='icon'
          onClick={() => onDateChange(goToNextDate(effectiveView, date, weekStartsOn))}
          aria-label='Next'>
          <ChevronRight />
        </Button>
        <DateTimePicker
          value={date}
          onChange={(value) => value && onDateChange(value)}
          mode='date'
          notClearable>
          <Button variant='ghost' size='sm'>
            {dateLabel(effectiveView, date, weekStartsOn)}
          </Button>
        </DateTimePicker>
      </div>

      {boardMode !== 'map' && (
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
      )}

      {(view === 'day' || boardMode === 'map') && (
        <WorkerFilterPopover
          workers={workers}
          selectedWorkerIds={selectedWorkerIds}
          onChange={onSelectedWorkerIdsChange}
        />
      )}

      {boardMode === 'map' && (
        <TagFilterPopover tags={tags} selectedTags={selectedTags} onChange={onSelectedTagsChange} />
      )}

      <RadioTab
        value={boardMode}
        onValueChange={(v) => onBoardModeChange(v as BoardMode)}
        size='sm'>
        <RadioTabItem value='calendar' size='sm' tooltip='Board'>
          <LayoutGrid />
          <span className='hidden sm:inline'>Board</span>
        </RadioTabItem>
        <RadioTabItem value='map' size='sm' tooltip='Map'>
          <MapIcon />
          <span className='hidden sm:inline'>Map</span>
        </RadioTabItem>
      </RadioTab>

      <div className='flex-1' />
    </div>
  )
}
