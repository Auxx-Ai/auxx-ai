// apps/web/src/components/pickers/date-time-picker/components/picker-header.tsx
'use client'

import React from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { format } from 'date-fns'
import { ViewType, type PickerHeaderProps } from '../types'
import { useMonthOptions } from '../hooks'

/**
 * Dynamic header component that changes based on current view
 */
const PickerHeader: React.FC<PickerHeaderProps> = ({
  view,
  mode,
  currentMonth,
  selectedYear,
  selectedMonth,
  onOpenYearMonthPicker,
  onCloseYearMonthPicker,
  onNextMonth,
  onPrevMonth,
}) => {
  const months = useMonthOptions()

  // Time-only mode: simple header or no header
  if (mode === 'time' || view === ViewType.Time) {
    return (
      <div className="border-b px-1 p-2 h-10 flex items-center">
        <div className="flex items-center gap-x-0.5 rounded-xl px-2 py-1.5 text-sm font-semibold text-primary-900 hover:bg-primary-100 cursor-default">
          <span>Select Time</span>
        </div>
      </div>
    )
  }

  // Year/Month picker view
  if (view === ViewType.YearMonth) {
    return (
      <div className="flex items-center border-b px-1 py-2  h-10">
        <button
          type="button"
          onClick={onCloseYearMonthPicker}
          className="flex items-center gap-x-0.5 rounded-xl px-2 py-1.5 text-sm font-semibold text-primary-900 hover:bg-primary-100">
          <span>{`${months[selectedMonth]} ${selectedYear}`}</span>
          <ChevronUp className="size-4 text-secondary-500" />
        </button>
      </div>
    )
  }

  // Time picker view (within datetime mode)
  // if (view === ViewType.Time) {
  //   return (
  //     <div className="border-b px-3  h-9">
  //       <span className="text-sm font-medium text-secondary-700">Select Time</span>
  //     </div>
  //   )
  // }

  // Calendar view (default)
  return (
    <div className="px-1 pe-1.5 flex items-center h-10 border-b">
      <div className="flex-1">
        <button
          type="button"
          onClick={onOpenYearMonthPicker}
          className="flex items-center gap-x-0.5 rounded-xl px-2 py-1.5 text-sm font-semibold text-primary-900 hover:bg-primary-100">
          <span>{format(currentMonth, 'MMMM yyyy')}</span>
          <ChevronDown className="size-4 text-secondary-500" />
        </button>
      </div>
      <button
        type="button"
        onClick={onPrevMonth}
        className="rounded-xl p-1.5 hover:bg-primary-100"
        aria-label="Previous month">
        <ChevronUp className="size-[18px] text-secondary-600" />
      </button>
      <button
        type="button"
        onClick={onNextMonth}
        className="rounded-xl p-1.5 hover:bg-primary-100"
        aria-label="Next month">
        <ChevronDown className="size-[18px] text-secondary-600" />
      </button>
    </div>
  )
}

export default React.memo(PickerHeader)
