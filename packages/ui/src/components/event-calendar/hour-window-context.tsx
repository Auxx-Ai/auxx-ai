// packages/ui/src/components/event-calendar/hour-window-context.tsx

'use client'

import { createContext, type ReactNode, useContext } from 'react'

import { EndHour, StartHour } from './constants'
import type { TimelineHourWindow } from './types'

/**
 * The visible hour window for the vertical time grids (week/day/resource) and the horizontal
 * timeline — `[start, end)` whole hours the grid renders instead of the full `0..24` day. Set by
 * the consumer (dispatch's board) via `EventCalendar`'s `hourWindow` prop; the geometry leaves
 * (`positionEventsForDay` callers, off-hours shading, current-time indicator, drop preview) read
 * it here so the crop offset lives in ONE place rather than threaded through every memoized column.
 *
 * Defaults to the full day (`StartHour..EndHour`) so every non-board consumer (e.g. the records
 * calendar) is unaffected.
 */
const HourWindowContext = createContext<TimelineHourWindow>({ start: StartHour, end: EndHour })

/** Read the calendar's visible hour window (`{ start, end }`, whole hours, default `0..24`). */
export function useHourWindow(): TimelineHourWindow {
  return useContext(HourWindowContext)
}

export function HourWindowProvider({
  value,
  children,
}: {
  value: TimelineHourWindow
  children: ReactNode
}) {
  return <HourWindowContext.Provider value={value}>{children}</HourWindowContext.Provider>
}
