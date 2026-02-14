// apps/web/src/components/ai/ui/badge-ai-quota.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import { formatDistance, isValid, parseISO } from 'date-fns'
import { Tooltip } from '~/components/global/tooltip'

interface BadgeAiQuotaProps {
  /** Type of quota: trial, paid, free */
  quotaType: string | null
  /** Current usage amount */
  quotaUsed: number
  /** Maximum quota limit (-1 for unlimited) */
  quotaLimit: number
  /** When the quota resets (end of current period) */
  resetsAt?: Date | string | null
  /** Additional CSS classes */
  className?: string
}

/**
 * BadgeAiQuota - Shows remaining AI credits
 */
export function BadgeAiQuota({ quotaUsed, quotaLimit, resetsAt, className }: BadgeAiQuotaProps) {
  const isUnlimited = quotaLimit === -1
  const remaining = isUnlimited ? Infinity : Math.max(0, quotaLimit - quotaUsed)
  const usagePercent = isUnlimited ? 0 : Math.round((quotaUsed / quotaLimit) * 100)

  /** Format the reset date for tooltip using formatDistance */
  const getResetText = (): string | null => {
    if (!resetsAt) return null

    const resetDate = typeof resetsAt === 'string' ? parseISO(resetsAt) : resetsAt
    if (!isValid(resetDate)) return null

    const now = new Date()

    // If reset date is in the past, return null to use fallback
    if (resetDate <= now) return null

    // Use formatDistance for human-readable relative time
    // e.g., "in 5 days", "in about 1 month", "in 2 hours"
    const distance = formatDistance(resetDate, now, { addSuffix: true })
    return `Resets ${distance}`
  }

  const resetText = getResetText()
  const tooltipText = isUnlimited
    ? 'Unlimited credits'
    : (resetText ?? `Out of a total of ${quotaLimit} (${usagePercent}%)`)

  return (
    <Tooltip content={tooltipText}>
      <Badge variant='secondary' className={cn('text-xs cursor-default', className)}>
        {isUnlimited ? (
          'Unlimited'
        ) : (
          <>
            {remaining}
            <span className='ms-1 font-semibold'>credits</span>
          </>
        )}
      </Badge>
    </Tooltip>
  )
}

export default BadgeAiQuota
