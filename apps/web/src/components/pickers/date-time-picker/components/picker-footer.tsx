// apps/web/src/components/pickers/date-time-picker/components/picker-footer.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { Clock } from 'lucide-react'
import React from 'react'
import { type PickerFooterProps, ViewType } from '../types'

/**
 * Dynamic footer component that changes based on current view
 */
const PickerFooter: React.FC<PickerFooterProps> = ({
  view,
  mode,
  showTimeToggle,
  displayTime,
  onToggleTimePicker,
  onSelectNow,
  onConfirm,
  onYearMonthCancel,
  onYearMonthConfirm,
  hideNowButton,
}) => {
  // Year/Month picker view: Cancel + Confirm buttons
  if (view === ViewType.YearMonth) {
    return (
      <div className='grid grid-cols-2 gap-x-1 border-t p-2'>
        <Button variant='outline' size='sm' onClick={onYearMonthCancel}>
          Cancel
        </Button>
        <Button size='sm' onClick={onYearMonthConfirm}>
          OK
        </Button>
      </div>
    )
  }

  // Time-only mode: simple footer
  if (mode === 'time') {
    return (
      <div className='flex items-center justify-between border-t p-2'>
        {!hideNowButton && (
          <Button variant='ghost' size='sm' onClick={onSelectNow}>
            Now
          </Button>
        )}
        <Button size='sm' onClick={onConfirm} className={cn(hideNowButton && 'ml-auto')}>
          Confirm
        </Button>
      </div>
    )
  }

  // Calendar/Time view for date or datetime mode
  return (
    <div
      className={cn(
        'flex items-center justify-between border-t p-2',
        !showTimeToggle && 'justify-end'
      )}>
      {/* Time Picker Toggle (only in datetime mode) */}
      {showTimeToggle && (
        <Button
          type='button'
          variant='ghost'
          size='sm'
          className='w-[90px] border'
          onClick={onToggleTimePicker}>
          <Clock />
          {view === ViewType.Calendar && <span>{displayTime}</span>}
          {view === ViewType.Time && <span>Pick Date</span>}
        </Button>
      )}

      <div className='flex items-center gap-x-1'>
        {/* Now / Today Button */}
        {!hideNowButton && (
          <Button variant='ghost' size='sm' onClick={onSelectNow}>
            {mode === 'date' ? 'Today' : 'Now'}
          </Button>
        )}
        {/* Confirm Button */}
        <Button size='sm' onClick={onConfirm}>
          OK
        </Button>
      </div>
    </div>
  )
}

export default React.memo(PickerFooter)
