// apps/web/src/components/dispatch/ui/board/board-toolbar.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { RadioTab, RadioTabItem } from '@auxx/ui/components/radio-tab'
import { Separator } from '@auxx/ui/components/separator'
import { startOfWeek } from 'date-fns'
import {
  CalendarDays,
  CalendarPlus,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  GalleryHorizontal,
  LayoutGrid,
  Map as MapIcon,
  PanelLeft,
} from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import { useDispatchSidebarStore } from '../../stores/dispatch-sidebar-store'
import { useTimelineViewStore } from '../../stores/timeline-view-store'
import type { BoardViewMode } from './types'
import { goToNextDate, goToPreviousDate, type WeekStartIndex } from './utils'

export type BoardMode = 'calendar' | 'map'

/** `RadioTab size='sm'` is h-8 — one notch above the toolbar's h-7 button scale, so both
 * segmented controls take a height + item-padding override to sit flush with `icon-sm`. */
const RADIO_TAB_CLASS = 'h-7'
const RADIO_TAB_ITEM_CLASS = 'px-2'

interface BoardToolbarProps {
  date: Date
  /** Window navigation (prev/next chevrons) — steps the anchor by the active view's unit. In month
   * view the board's reducer keeps the anchor's day-of-month; see `use-board-data.ts`. */
  onDateChange: (date: Date) => void
  /** Absolute day jump (Today) — sets the exact day as the anchor, bypassing the month reducer. */
  onDateSelect: (date: Date) => void
  view: BoardViewMode
  onViewChange: (view: BoardViewMode) => void
  weekStartsOn: WeekStartIndex
  boardMode: BoardMode
  onBoardModeChange: (mode: BoardMode) => void
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
  onDateSelect,
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

  // Per-device "show everything" reveal (plan 42 §4) — un-hides empty off-day columns AND widens
  // the hour window to 0-24. Only meaningful on the multi-day week/timeline streams.
  const showAllDays = useTimelineViewStore((s) => s.showAllDays)
  const setShowAllDays = useTimelineViewStore((s) => s.setShowAllDays)
  const showAllDaysApplies = !isMap && (view === 'week' || view === 'timeline')

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
        <Button
          variant='ghost'
          size='sm'
          onClick={() =>
            onDateSelect(
              effectiveView === 'week' ? startOfWeek(new Date(), { weekStartsOn }) : new Date()
            )
          }>
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
          <RadioTabItem value='timeline' tooltip='Timeline' className={RADIO_TAB_ITEM_CLASS}>
            <GalleryHorizontal />
            <span className='hidden sm:inline'>Timeline</span>
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

      {showAllDaysApplies && (
        <Tooltip content='Show all days and hours'>
          <Button
            variant={showAllDays ? 'secondary' : 'ghost'}
            size='sm'
            onClick={() => setShowAllDays(!showAllDays)}>
            <CalendarPlus />
            <span className='hidden sm:inline'>Show all days</span>
          </Button>
        </Tooltip>
      )}

      <div className='flex-1' />
    </div>
  )
}
