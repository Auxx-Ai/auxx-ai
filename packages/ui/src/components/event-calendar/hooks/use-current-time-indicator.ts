// packages/ui/src/components/event-calendar/hooks/use-current-time-indicator.ts

'use client'

import { endOfWeek, format, isSameDay, isWithinInterval, startOfWeek } from 'date-fns'
import { useEffect, useState } from 'react'

import { EndHour, StartHour } from '../constants'

export interface UseCurrentTimeIndicatorResult {
  /** Top offset, as a percentage of the day's rendered hour range. */
  currentTimePosition: number
  /** Whether "now" falls within the visible day/week. */
  currentTimeVisible: boolean
  /** Pre-formatted "HH:mm" label for the gutter pill. */
  currentTimeLabel: string
}

export function useCurrentTimeIndicator(
  currentDate: Date,
  view: 'day' | 'week' | 'resource',
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 1
): UseCurrentTimeIndicatorResult {
  const [result, setResult] = useState<UseCurrentTimeIndicatorResult>({
    currentTimePosition: 0,
    currentTimeVisible: false,
    currentTimeLabel: '',
  })

  useEffect(() => {
    const calculateTimePosition = () => {
      const now = new Date()
      const hours = now.getHours()
      const minutes = now.getMinutes()
      const totalMinutes = (hours - StartHour) * 60 + minutes
      const dayStartMinutes = 0
      const dayEndMinutes = (EndHour - StartHour) * 60

      const position = ((totalMinutes - dayStartMinutes) / (dayEndMinutes - dayStartMinutes)) * 100

      let isCurrentTimeVisible = false

      if (view === 'day' || view === 'resource') {
        isCurrentTimeVisible = isSameDay(now, currentDate)
      } else if (view === 'week') {
        const startOfWeekDate = startOfWeek(currentDate, { weekStartsOn })
        const endOfWeekDate = endOfWeek(currentDate, { weekStartsOn })
        isCurrentTimeVisible = isWithinInterval(now, { start: startOfWeekDate, end: endOfWeekDate })
      }

      setResult({
        currentTimePosition: position,
        currentTimeVisible: isCurrentTimeVisible,
        currentTimeLabel: format(now, 'HH:mm'),
      })
    }

    calculateTimePosition()
    const interval = setInterval(calculateTimePosition, 60000)
    return () => clearInterval(interval)
  }, [currentDate, view, weekStartsOn])

  return result
}
