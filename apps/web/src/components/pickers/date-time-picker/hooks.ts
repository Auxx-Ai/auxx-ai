// apps/web/src/components/pickers/date-time-picker/hooks.ts

import { useMemo } from 'react'
import { Period } from './types'

/**
 * Generate time option arrays for hours, minutes, and period
 */
export function useTimeOptions() {
  const hourOptions = useMemo(
    () => Array.from({ length: 12 }, (_, i) => (i + 1).toString().padStart(2, '0')),
    []
  )

  /** 24-hour variant of hourOptions ('00'..'23'), used when use24HourTime is set */
  const hourOptions24 = useMemo(
    () => Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0')),
    []
  )

  const minuteOptions = useMemo(
    () => Array.from({ length: 60 }, (_, i) => i.toString().padStart(2, '0')),
    []
  )

  const periodOptions = useMemo(() => [Period.AM, Period.PM], [])

  return { hourOptions, hourOptions24, minuteOptions, periodOptions }
}
