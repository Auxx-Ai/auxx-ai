// apps/web/src/components/pickers/date-time-picker/views/calendar-view.tsx
'use client'

import { Calendar } from '@auxx/ui/components/calendar'
import React from 'react'
import type { CalendarViewProps } from '../types'

/**
 * Calendar view — thin wrapper around the shared Calendar component. `captionLayout='dropdown'`
 * gives it the picker-header look (month/year label + chevrons) and its own built-in
 * year-month swap, so this view no longer needs a separate header or year/month state.
 */
const CalendarView: React.FC<CalendarViewProps> = ({
  currentMonth,
  onMonthChange,
  selectedDate,
  onDateSelect,
  minDate,
  maxDate,
  disabledDates,
}) => {
  return (
    <Calendar
      mode='single'
      month={currentMonth}
      onMonthChange={onMonthChange}
      selected={selectedDate}
      onSelect={onDateSelect}
      disabled={disabledDates}
      minDate={minDate}
      maxDate={maxDate}
      showOutsideDays={true}
      captionLayout='dropdown'
      className='p-2'
    />
  )
}

export default React.memo(CalendarView)
