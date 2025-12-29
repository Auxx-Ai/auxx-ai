// apps/web/src/components/pickers/date-time-picker/hooks.ts

import { useMemo } from 'react'
import { Period } from './types'

/** Year range for year picker (50 years before and after current year) */
const YEAR_RANGE = 50

/**
 * Generate time option arrays for hours, minutes, and period
 */
export function useTimeOptions() {
  const hourOptions = useMemo(
    () => Array.from({ length: 12 }, (_, i) => (i + 1).toString().padStart(2, '0')),
    []
  )

  const minuteOptions = useMemo(
    () => Array.from({ length: 60 }, (_, i) => i.toString().padStart(2, '0')),
    []
  )

  const periodOptions = useMemo(() => [Period.AM, Period.PM], [])

  return { hourOptions, minuteOptions, periodOptions }
}

/**
 * Generate month names for month picker
 */
export function useMonthOptions() {
  const monthOptions = useMemo(
    () => [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ],
    []
  )

  return monthOptions
}

/**
 * Generate year options centered around current year
 */
export function useYearOptions() {
  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear()
    return Array.from({ length: YEAR_RANGE * 2 }, (_, i) => currentYear - YEAR_RANGE + i)
  }, [])

  return yearOptions
}
