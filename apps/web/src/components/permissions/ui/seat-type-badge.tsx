// apps/web/src/components/permissions/ui/seat-type-badge.tsx
'use client'

import type { SeatType } from '@auxx/database/types'
import { Badge } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import { HardHat } from 'lucide-react'

interface SeatTypeBadgeProps {
  seatType: SeatType
  /** When true, also render a muted "Full member" badge for `'full'` seats.
   * Defaults to false — full seats render nothing (the common case where the
   * badge only marks the exceptional field seat). */
  showFull?: boolean
  className?: string
}

/**
 * Small badge marking a member's seat packaging. Renders "Field seat" for
 * `seatType === 'worker'`; renders nothing for `'full'` unless `showFull` is
 * set (then a muted "Full member" label). Naming per §11.1 — the DB value stays
 * `'worker'`, the label is always "Field seat".
 */
export function SeatTypeBadge({ seatType, showFull = false, className }: SeatTypeBadgeProps) {
  if (seatType === 'worker') {
    return (
      <Badge variant='amber' size='xs' className={cn('gap-1', className)}>
        <HardHat />
        <span>Field seat</span>
      </Badge>
    )
  }

  if (showFull) {
    return (
      <Badge variant='secondary' size='xs' className={className}>
        Full member
      </Badge>
    )
  }

  return null
}
