// packages/ui/src/components/calendar/calendar-caption.tsx

'use client'

import { format } from 'date-fns'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { CalendarView } from './types'

export interface CalendarCaptionProps {
  month: Date
  layout: 'label' | 'dropdown'
  view: CalendarView
  /** Toggles between the day grid and `YearMonthView`. Only used by the `'dropdown'` layout. */
  onToggleView?: () => void
  onPrev: () => void
  onNext: () => void
  hideNavigation: boolean
}

/**
 * Month caption. `'label'` renders a plain centered `MMMM yyyy` string — the calendar root
 * overlays its own prev/next buttons on top of it. `'dropdown'` renders the date-time-picker
 * header look instead: a label button that flips `YearMonthView` open, plus its own prev/next
 * chevrons (this layout owns navigation itself, so the root nav is not rendered alongside it).
 */
export function CalendarCaption({
  month,
  layout,
  view,
  onToggleView,
  onPrev,
  onNext,
  hideNavigation,
}: CalendarCaptionProps) {
  if (layout === 'dropdown') {
    const isYearMonth = view === 'year-month'
    return (
      <div data-slot='caption' className='flex h-10 items-center border-b px-1 pe-1.5'>
        <div className='flex-1'>
          <button
            type='button'
            onClick={onToggleView}
            className='flex items-center gap-x-0.5 rounded-xl px-2 py-1.5 text-sm font-semibold text-primary-900 hover:bg-primary-100'>
            <span data-slot='caption-label'>{format(month, 'MMMM yyyy')}</span>
            {isYearMonth ? (
              <ChevronUp className='size-4 text-secondary-500' />
            ) : (
              <ChevronDown className='size-4 text-secondary-500' />
            )}
          </button>
        </div>
        {!hideNavigation && !isYearMonth && (
          <div data-slot='nav' className='flex items-center'>
            <button
              type='button'
              data-slot='nav-button'
              data-direction='prev'
              onClick={onPrev}
              className='rounded-xl p-1.5 hover:bg-primary-100'
              aria-label='Previous month'>
              <ChevronUp className='size-[18px] text-secondary-600' />
            </button>
            <button
              type='button'
              data-slot='nav-button'
              data-direction='next'
              onClick={onNext}
              className='rounded-xl p-1.5 hover:bg-primary-100'
              aria-label='Next month'>
              <ChevronDown className='size-[18px] text-secondary-600' />
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div data-slot='caption' className='relative flex h-9 items-center justify-center'>
      <span data-slot='caption-label' className='text-sm font-medium'>
        {format(month, 'MMMM yyyy')}
      </span>
    </div>
  )
}
