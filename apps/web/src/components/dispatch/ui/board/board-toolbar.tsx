// apps/web/src/components/dispatch/ui/board/board-toolbar.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { Separator } from '@auxx/ui/components/separator'
import { endOfWeek, format, startOfWeek } from 'date-fns'
import {
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Map as MapIcon,
  PanelLeft,
  PanelRight,
} from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import { DateTimePicker } from '~/components/pickers/date-time-picker'
import { TagFilterPopover } from '../route-planner/tag-filter-popover'
import type { BoardViewMode, BoardWorker } from './types'
import { goToNextDate, goToPreviousDate, viewedMonthStart, type WeekStartIndex } from './utils'
import { WorkerFilterPopover } from './worker-filter-popover'

export type BoardMode = 'calendar' | 'map'

/** `RadioTab size='sm'` is h-8 — one notch above the toolbar's h-7 button scale, so both
 * segmented controls take a height + item-padding override to sit flush with `icon-sm`. */
const RADIO_TAB_CLASS = 'h-7'
const RADIO_TAB_ITEM_CLASS = 'px-2'

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
  /** Map-mode planner panels (route-planner restyle): the toolbar owns both toggles. */
  plannerShowBacklog: boolean
  onPlannerShowBacklogChange: (show: boolean) => void
  plannerShowStops: boolean
  onPlannerShowStopsChange: (show: boolean) => void
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
 * Board toolbar (07 §D.2, extended by 09-route-planner.md §A) on the workflow-toolbar design
 * scale (`gap-1 p-1`, ghost h-7 buttons, `Separator` group dividers, tooltips). Ordered to avoid
 * layout shifts when toggling Board↔Map: the stable prefix (left-panel toggle, Board/Map switch,
 * date nav with a fixed-width label) never moves; mode-conditional controls (Day/Week/Month vs
 * tag filter) swap in the region after it, and the map-only right-panel toggle is anchored at
 * the far right past the spacer. The left-panel toggle is mode-appropriate: calendar backlog
 * rail vs planner backlog overlay.
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
  plannerShowBacklog,
  onPlannerShowBacklogChange,
  plannerShowStops,
  onPlannerShowStopsChange,
  tags,
  selectedTags,
  onSelectedTagsChange,
}: BoardToolbarProps) {
  // Map mode is always a single day (route planning is inherently day-scoped, contract item 7)
  // regardless of whatever Day/Week/Month `view` the calendar was last left on — date nav and
  // the label both step/format as a day while map mode is active.
  const effectiveView: BoardViewMode = boardMode === 'map' ? 'day' : view
  const isMap = boardMode === 'map'
  const leftPanelOpen = isMap ? plannerShowBacklog : showBacklog
  const toggleLeftPanel = () =>
    isMap ? onPlannerShowBacklogChange(!plannerShowBacklog) : onShowBacklogChange(!showBacklog)

  return (
    <div className='flex flex-wrap items-center gap-1 border-b p-1'>
      <Tooltip content={isMap ? 'Toggle backlog panel' : 'Toggle backlog rail'}>
        <Button
          variant={leftPanelOpen ? 'secondary' : 'ghost'}
          size='icon-sm'
          onClick={toggleLeftPanel}>
          <PanelLeft />
        </Button>
      </Tooltip>

      <RadioTab
        value={boardMode}
        onValueChange={(v) => onBoardModeChange(v as BoardMode)}
        size='sm'
        className={RADIO_TAB_CLASS}>
        <RadioTabItem value='calendar' tooltip='Board' className={RADIO_TAB_ITEM_CLASS}>
          <LayoutGrid />
          <span className='hidden sm:inline'>Board</span>
        </RadioTabItem>
        <RadioTabItem value='map' tooltip='Map' className={RADIO_TAB_ITEM_CLASS}>
          <MapIcon />
          <span className='hidden sm:inline'>Map</span>
        </RadioTabItem>
      </RadioTab>

      <Separator orientation='vertical' className='h-6' />

      <div className='flex items-center gap-1'>
        <Button variant='ghost' size='sm' onClick={() => onDateChange(new Date())}>
          Today
        </Button>
        <Button
          variant='ghost'
          size='icon-sm'
          onClick={() => onDateChange(goToPreviousDate(effectiveView, date, weekStartsOn))}
          aria-label='Previous'>
          <ChevronLeft />
        </Button>
        <Button
          variant='ghost'
          size='icon-sm'
          onClick={() => onDateChange(goToNextDate(effectiveView, date, weekStartsOn))}
          aria-label='Next'>
          <ChevronRight />
        </Button>
        <DateTimePicker
          value={date}
          onChange={(value) => value && onDateChange(value)}
          mode='date'
          notClearable>
          {/* Fixed width — the label re-formats per view/day and must not shift its neighbors. */}
          <Button variant='ghost' size='sm' className='w-44 justify-center truncate'>
            {dateLabel(effectiveView, date, weekStartsOn)}
          </Button>
        </DateTimePicker>
      </div>

      <Separator orientation='vertical' className='h-6' />

      {!isMap && (
        <RadioTab
          value={view}
          onValueChange={(v) => onViewChange(v as BoardViewMode)}
          size='sm'
          className={RADIO_TAB_CLASS}>
          <RadioTabItem value='day' tooltip='Day' className={RADIO_TAB_ITEM_CLASS}>
            <CalendarDays />
            <span className='hidden sm:inline'>Day</span>
          </RadioTabItem>
          <RadioTabItem value='week' tooltip='Week' className={RADIO_TAB_ITEM_CLASS}>
            <CalendarRange />
            <span className='hidden sm:inline'>Week</span>
          </RadioTabItem>
          <RadioTabItem value='month' tooltip='Month' className={RADIO_TAB_ITEM_CLASS}>
            <CalendarDays />
            <span className='hidden sm:inline'>Month</span>
          </RadioTabItem>
        </RadioTab>
      )}

      {(view === 'day' || isMap) && (
        <WorkerFilterPopover
          workers={workers}
          selectedWorkerIds={selectedWorkerIds}
          onChange={onSelectedWorkerIdsChange}
        />
      )}

      {isMap && (
        <TagFilterPopover tags={tags} selectedTags={selectedTags} onChange={onSelectedTagsChange} />
      )}

      <div className='flex-1' />

      {isMap && (
        <Tooltip content='Toggle routes panel'>
          <Button
            variant={plannerShowStops ? 'secondary' : 'ghost'}
            size='icon-sm'
            onClick={() => onPlannerShowStopsChange(!plannerShowStops)}>
            <PanelRight />
          </Button>
        </Tooltip>
      )}
    </div>
  )
}
