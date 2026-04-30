// apps/web/src/components/kb/ui/settings/section-header.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import { formatRelativeTime } from '@auxx/utils/date'
import { useEffect, useState } from 'react'

interface SectionStatusBadgeProps {
  drafted?: boolean
  saving?: boolean
  savedAt?: Date | null
  className?: string
}

/**
 * Small trailing badge for a settings <Section> actions slot. Shows:
 *  - A pulsing amber dot + "drafted" when the section currently has pending
 *    fields in the KB draft envelope.
 *  - "Saving…" while an autosave is in-flight.
 *  - "Saved · just now / 2m / 1h" briefly after a successful autosave; hides
 *    after an hour.
 */
export function SectionStatusBadge({
  drafted,
  saving,
  savedAt,
  className,
}: SectionStatusBadgeProps) {
  const savedLabel = useSavedAtLabel(savedAt)

  if (saving) {
    return <span className={cn('text-xs text-muted-foreground', className)}>Saving…</span>
  }
  if (savedAt && savedLabel) {
    return (
      <span
        className={cn('text-xs text-muted-foreground', className)}>{`Saved · ${savedLabel}`}</span>
    )
  }
  if (drafted) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400',
          className
        )}>
        <span className='inline-block size-1.5 animate-pulse rounded-full bg-amber-500' />
        drafted
      </span>
    )
  }
  return null
}

function useSavedAtLabel(date: Date | null | undefined): string | null {
  const [, force] = useState(0)
  useEffect(() => {
    if (!date) return
    const t = setInterval(() => force((n) => n + 1), 5_000)
    return () => clearInterval(t)
  }, [date])
  if (!date) return null
  const diff = Math.max(0, Date.now() - date.getTime())
  if (diff < 4_000) return 'just now'
  if (diff >= 60 * 60_000) return null
  return formatRelativeTime(date, true)
}
