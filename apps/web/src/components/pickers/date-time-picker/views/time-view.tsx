// apps/web/src/components/pickers/date-time-picker/views/time-view.tsx
'use client'

import React from 'react'
import { useTimeOptions } from '../hooks'
import { Period, type TimeViewProps } from '../types'
import { getHourIn12HourFormat, getPeriod } from '../utils'
import OptionListItem from '../components/option-list-item'

/**
 * Time selection view with three scrollable columns (hours, minutes, period)
 */
const TimeView: React.FC<TimeViewProps> = ({
  selectedTime,
  minuteFilter,
  onSelectHour,
  onSelectMinute,
  onSelectPeriod,
}) => {
  const { hourOptions, minuteOptions, periodOptions } = useTimeOptions()

  // Get current selections from selectedTime
  const selectedHour = selectedTime
    ? getHourIn12HourFormat(selectedTime).toString().padStart(2, '0')
    : undefined
  const selectedMinute = selectedTime
    ? selectedTime.getMinutes().toString().padStart(2, '0')
    : undefined
  const selectedPeriodValue = selectedTime ? getPeriod(selectedTime) : undefined

  // Apply minute filter if provided
  const filteredMinutes = minuteFilter ? minuteFilter(minuteOptions) : minuteOptions
  //h-[208px]
  return (
    <div className="grid grid-cols-3 gap-x-1 p-2">
      {/* Hour column */}
      <ul className="no-scrollbar flex h-[235px]  flex-col gap-y-0.5 overflow-y-auto pb-[184px]">
        {hourOptions.map((hour) => (
          <OptionListItem
            key={hour}
            isSelected={selectedHour === hour}
            onClick={() => onSelectHour(hour)}>
            {hour}
          </OptionListItem>
        ))}
      </ul>

      {/* Minute column */}
      <ul className="no-scrollbar flex h-[235px] flex-col gap-y-0.5 overflow-y-auto pb-[184px]">
        {filteredMinutes.map((minute) => (
          <OptionListItem
            key={minute}
            isSelected={selectedMinute === minute}
            onClick={() => onSelectMinute(minute)}>
            {minute}
          </OptionListItem>
        ))}
      </ul>

      {/* Period column */}
      <ul className="no-scrollbar flex h-[235px] flex-col gap-y-0.5 overflow-y-auto pb-[184px]">
        {periodOptions.map((period) => (
          <OptionListItem
            key={period}
            isSelected={selectedPeriodValue === period}
            onClick={() => onSelectPeriod(period)}
            noAutoScroll // Prevent hiding AM when PM is selected
          >
            {period}
          </OptionListItem>
        ))}
      </ul>
    </div>
  )
}

export default React.memo(TimeView)
