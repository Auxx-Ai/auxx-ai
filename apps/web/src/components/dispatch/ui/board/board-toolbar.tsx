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
} from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import { DateTimePicker } from '~/components/pickers/date-time-picker'
import { useDispatchSidebarStore } from '../../stores/dispatch-sidebar-store'
import type { BoardViewMode } from './types'
import { goToNextDate, goToPreviousDate, viewedMonthStart, type WeekStartIndex } from './utils'

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
  boardMode: BoardMode
  onBoardModeChange: (mode: BoardMode) => void
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
 * Board toolbar (07 §D.2, restyled by the v3 module-sidebar plan) on the workflow-toolbar
 * design scale (`gap-1 p-1`, ghost h-7 buttons, `Separator` group dividers, tooltips). Ordered
 * to avoid layout shifts when toggling Board↔Map: the stable prefix (sidebar toggle, Board/Map
 * switch, date nav with a fixed-width label) never moves; mode-conditional controls
 * (Day/Week/Month) swap in the region after it. Worker/tag filtering and the Routes panel moved
 * into the one `DispatchSidebar` (`dispatch/ui/sidebar/`) — this toolbar owns a single
 * `PanelLeft` toggle bound to the dispatch-sidebar store's `open`, replacing the old mode-aware
 * left-panel toggle AND the map-only right-panel (stops) toggle.
 */
export function BoardToolbar({
  date,
  onDateChange,
  view,
  onViewChange,
  weekStartsOn,
  boardMode,
  onBoardModeChange,
}: BoardToolbarProps) {
  // Map mode is always a single day (route planning is inherently day-scoped, contract item 7)
  // regardless of whatever Day/Week/Month `view` the calendar was last left on — date nav and
  // the label both step/format as a day while map mode is active.
  const effectiveView: BoardViewMode = boardMode === 'map' ? 'day' : view
  const isMap = boardMode === 'map'

  const sidebarOpen = useDispatchSidebarStore((s) => s.open)
  const setSidebarOpen = useDispatchSidebarStore((s) => s.setOpen)

  return (
    <div className='flex flex-wrap items-center gap-1 border-b p-1'>
      <Tooltip content='Toggle sidebar'>
        <Button
          variant={sidebarOpen ? 'secondary' : 'ghost'}
          size='icon-sm'
          onClick={() => setSidebarOpen(!sidebarOpen)}>
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

      <div className='flex-1' />
    </div>
  )
}
