// apps/web/src/components/dispatch/ui/shared/inline-event-time-picker.tsx

'use client'

import type { EventTimeEditorProps } from '@auxx/ui/components/event-calendar'
import { cn } from '@auxx/ui/lib/utils'
import { useState } from 'react'
import { DateTimePickerContent } from '~/components/pickers/date-time-picker'

/** Dispatch's inline start/end editor backed by the shared scrolling time picker. */
export function InlineEventTimePicker({ start, end, use24Hour, onCommit }: EventTimeEditorProps) {
  const [active, setActive] = useState<'start' | 'end'>('start')
  const value = active === 'start' ? start : end

  return (
    <div className='space-y-2'>
      <div className='grid grid-cols-2 rounded-lg bg-muted p-1'>
        {(['start', 'end'] as const).map((which) => (
          <button
            key={which}
            type='button'
            className={cn(
              'rounded-md px-2 py-1.5 text-sm capitalize transition-colors',
              active === which
                ? 'bg-background font-medium text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={() => setActive(which)}>
            {which}
          </button>
        ))}
      </div>
      <DateTimePickerContent
        value={value}
        mode='time'
        hideNowButton
        use24HourTime={use24Hour}
        className='w-full min-w-0'
        onChange={(next) => {
          if (!next) return
          onCommit(active, next.getHours(), next.getMinutes())
          if (active === 'start') setActive('end')
        }}
      />
    </div>
  )
}
