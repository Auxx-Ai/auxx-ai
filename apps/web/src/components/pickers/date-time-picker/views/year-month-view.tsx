// apps/web/src/components/pickers/date-time-picker/views/year-month-view.tsx
'use client'

import React from 'react'
import { useMonthOptions, useYearOptions } from '../hooks'
import type { YearMonthViewProps } from '../types'
import OptionListItem from '../components/option-list-item'

/**
 * Year and month selection view with two scrollable columns
 */
const YearMonthView: React.FC<YearMonthViewProps> = ({
  selectedMonth,
  selectedYear,
  onMonthSelect,
  onYearSelect,
}) => {
  const months = useMonthOptions()
  const yearOptions = useYearOptions()

  return (
    <div className="grid grid-cols-2 gap-x-1 p-2">
      {/* Month Picker */}
      <ul className="no-scrollbar flex h-[235px] flex-col gap-y-0.5 overflow-y-auto pb-[184px]">
        {months.map((month, index) => (
          <OptionListItem
            key={month}
            isSelected={selectedMonth === index}
            onClick={() => onMonthSelect(index)}>
            {month}
          </OptionListItem>
        ))}
      </ul>

      {/* Year Picker */}
      <ul className="no-scrollbar flex h-[235px] flex-col gap-y-0.5 overflow-y-auto pb-[184px]">
        {yearOptions.map((year) => (
          <OptionListItem
            key={year}
            isSelected={selectedYear === year}
            onClick={() => onYearSelect(year)}>
            {year}
          </OptionListItem>
        ))}
      </ul>
    </div>
  )
}

export default React.memo(YearMonthView)
