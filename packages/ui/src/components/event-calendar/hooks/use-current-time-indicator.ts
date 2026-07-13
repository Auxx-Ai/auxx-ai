// packages/ui/src/components/event-calendar/hooks/use-current-time-indicator.ts

'use client'

import { format, isSameDay } from 'date-fns'
import { useEffect, useState } from 'react'

import { EndHour, StartHour } from '../constants'

export interface UseCurrentTimeIndicatorResult {
  /** Top offset, as a percentage of the day's rendered hour range. */
  currentTimePosition: number
  /** Whether "now" falls within `currentDate`'s day. */
  currentTimeVisible: boolean
  /** Pre-formatted "HH:mm" label for the gutter pill. */
  currentTimeLabel: string
}

/**
 * Day/resource grids: "now" is visible whenever `currentDate` is today.
 *
 * Week view no longer calls this for visibility — its rendered day stream can
 * span many days at once, so it computes visibility locally against the
 * rendered window (see `week-view.tsx`) while still reusing this hook's
 * position/label math via a stable anchor date. `view` is accepted only to
 * keep the day/resource call sites' signature — the math no longer branches
 * on it.
 */
export function useCurrentTimeIndicator(
  currentDate: Date,
  view: 'day' | 'resource'
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

      setResult({
        currentTimePosition: position,
        currentTimeVisible: isSameDay(now, currentDate),
        currentTimeLabel: format(now, 'HH:mm'),
      })
    }

    calculateTimePosition()
    const interval = setInterval(calculateTimePosition, 60000)
    return () => clearInterval(interval)
  }, [currentDate])

  return result
}
