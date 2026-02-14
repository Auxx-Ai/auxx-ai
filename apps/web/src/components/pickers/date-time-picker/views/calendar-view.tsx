// apps/web/src/components/pickers/date-time-picker/views/calendar-view.tsx
'use client'

import { Calendar } from '@auxx/ui/components/calendar'
import React from 'react'
import type { CalendarViewProps } from '../types'

/**
 * Calendar view using react-day-picker via our Calendar component
 */
const CalendarView: React.FC<CalendarViewProps> = ({
  currentMonth,
  selectedDate,
  onDateSelect,
  minDate,
  maxDate,
  disabledDates,
}) => {
  /** Combined disabled function */
  const isDateDisabled = (date: Date): boolean => {
    if (minDate && date < minDate) return true
    if (maxDate && date > maxDate) return true
    if (disabledDates?.(date)) return true
    return false
  }

  return (
    <Calendar
      mode='single'
      month={currentMonth}
      selected={selectedDate}
      onSelect={(date) => date && onDateSelect(date)}
      disabled={isDateDisabled}
      showOutsideDays={true}
      className='p-2 min-h-[251px]'
      hideNavigation
      classNames={{
        month_caption: 'hidden',
      }}
    />
  )
}

export default React.memo(CalendarView)
