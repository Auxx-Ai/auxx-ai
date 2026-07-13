// packages/ui/src/components/event-calendar/event-popover/time-input.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import * as React from 'react'
import { AutosizeInput } from '../../autosize-input'
import { formatTimeOfDay, parseTimeInput } from './parse-time'

interface TimeInputProps {
  value: Date | null
  onCommit: (hours: number, minutes: number) => void
  use24Hour?: boolean
  placeholder?: string
  autoFocus?: boolean
  className?: string
}

/**
 * Freeform time-of-day text input (Notion-style). Commits on blur/Enter via `parseTimeInput`;
 * invalid input or Escape reverts to the last formatted `value`.
 */
export function TimeInput({
  value,
  onCommit,
  use24Hour,
  placeholder = '--:--',
  autoFocus,
  className,
}: TimeInputProps) {
  const formatted = value ? formatTimeOfDay(value, use24Hour) : ''
  const [draft, setDraft] = React.useState(formatted)
  const skipCommitRef = React.useRef(false)

  React.useEffect(() => {
    setDraft(formatted)
  }, [formatted])

  const commit = () => {
    if (skipCommitRef.current) {
      skipCommitRef.current = false
      setDraft(formatted)
      return
    }
    const parsed = parseTimeInput(draft)
    if (!parsed) {
      setDraft(formatted)
      return
    }
    onCommit(parsed.hours, parsed.minutes)
  }

  return (
    <AutosizeInput
      value={draft}
      placeholder={placeholder}
      autoFocus={autoFocus}
      minWidth={56}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          skipCommitRef.current = true
          setDraft(formatted)
          e.currentTarget.blur()
        }
      }}
      className={className}
      inputClassName={cn(
        'rounded-lg border border-border/50 bg-background px-2 py-1 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring/50'
      )}
    />
  )
}
