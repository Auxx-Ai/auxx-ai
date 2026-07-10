// apps/web/src/components/pickers/date-time-picker/views/time-view.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import React from 'react'
import OptionListItem from '../components/option-list-item'
import { useTimeOptions } from '../hooks'
import type { TimeViewProps } from '../types'
import { getHourIn12HourFormat, getPeriod } from '../utils'

/**
 * Time selection view with scrollable columns (hours, minutes, and — in 12-hour mode — period).
 * In `use24HourTime` mode the hours column lists '00'..'23' and the period column is hidden,
 * collapsing the grid to two columns; 12-hour behavior (the default) is unchanged.
 */
const TimeView: React.FC<TimeViewProps> = ({
  selectedTime,
  minuteFilter,
  use24HourTime = false,
  onSelectHour,
  onSelectMinute,
  onSelectPeriod,
}) => {
  const { hourOptions, hourOptions24, minuteOptions, periodOptions } = useTimeOptions()

  // Get current selections from selectedTime
  const selectedHour = selectedTime
    ? use24HourTime
      ? selectedTime.getHours().toString().padStart(2, '0')
      : getHourIn12HourFormat(selectedTime).toString().padStart(2, '0')
    : undefined
  const selectedMinute = selectedTime
    ? selectedTime.getMinutes().toString().padStart(2, '0')
    : undefined
  const selectedPeriodValue = selectedTime ? getPeriod(selectedTime) : undefined

  // Apply minute filter if provided
  const filteredMinutes = minuteFilter ? minuteFilter(minuteOptions) : minuteOptions
  const hours = use24HourTime ? hourOptions24 : hourOptions
  //h-[208px]
  return (
    <div className={cn('grid gap-x-1 p-2', use24HourTime ? 'grid-cols-2' : 'grid-cols-3')}>
      {/* Hour column */}
      <ul className='no-scrollbar flex h-[235px]  flex-col gap-y-0.5 overflow-y-auto pb-[184px]'>
        {hours.map((hour) => (
          <OptionListItem
            key={hour}
            isSelected={selectedHour === hour}
            onClick={() => onSelectHour(hour)}>
            {hour}
          </OptionListItem>
        ))}
      </ul>

      {/* Minute column */}
      <ul className='no-scrollbar flex h-[235px] flex-col gap-y-0.5 overflow-y-auto pb-[184px]'>
        {filteredMinutes.map((minute) => (
          <OptionListItem
            key={minute}
            isSelected={selectedMinute === minute}
            onClick={() => onSelectMinute(minute)}>
            {minute}
          </OptionListItem>
        ))}
      </ul>

      {/* Period column (hidden in 24-hour mode) */}
      {!use24HourTime && (
        <ul className='no-scrollbar flex h-[235px] flex-col gap-y-0.5 overflow-y-auto pb-[184px]'>
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
      )}
    </div>
  )
}

export default React.memo(TimeView)
