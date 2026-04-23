// apps/web/src/components/ai/ui/badge-ai-quota.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { cn } from '@auxx/ui/lib/utils'
import { formatDistance, isValid, parseISO } from 'date-fns'
import { Tooltip } from '~/components/global/tooltip'

interface BadgeAiQuotaProps {
  /** Type of quota: trial, paid, free */
  quotaType: string | null
  /** Credits spent from the monthly allowance. */
  quotaUsed: number
  /** Monthly allowance from the active plan. -1 = unlimited. */
  quotaLimit: number
  /** Admin-granted bonus credits (PlanSubscription.creditsBalance). */
  bonusCredits?: number
  /** When the monthly quota resets. */
  resetsAt?: Date | string | null
  /** Additional CSS classes */
  className?: string
}

/**
 * BadgeAiQuota - Shows remaining AI credits (monthly + bonus combined).
 * Tooltip breaks the total down into monthly remaining + admin-granted bonus.
 */
export function BadgeAiQuota({
  quotaUsed,
  quotaLimit,
  bonusCredits = 0,
  resetsAt,
  className,
}: BadgeAiQuotaProps) {
  const isUnlimited = quotaLimit === -1
  const monthlyRemaining = isUnlimited
    ? Number.POSITIVE_INFINITY
    : Math.max(0, quotaLimit - quotaUsed)
  const bonus = Math.max(0, bonusCredits)
  const totalRemaining = isUnlimited ? Number.POSITIVE_INFINITY : monthlyRemaining + bonus
  const usagePercent = isUnlimited
    ? 0
    : quotaLimit > 0
      ? Math.round((quotaUsed / quotaLimit) * 100)
      : 0

  /** Format the reset date for tooltip using formatDistance */
  const getResetText = (): string | null => {
    if (!resetsAt) return null
    const resetDate = typeof resetsAt === 'string' ? parseISO(resetsAt) : resetsAt
    if (!isValid(resetDate)) return null
    const now = new Date()
    if (resetDate <= now) return null
    const distance = formatDistance(resetDate, now, { addSuffix: true })
    return `Monthly credits reset ${distance}`
  }

  const resetText = getResetText()
  const tooltipLines: string[] = []
  if (isUnlimited) {
    tooltipLines.push('Unlimited credits')
  } else {
    tooltipLines.push(
      `${monthlyRemaining} monthly credits (of ${quotaLimit}, ${usagePercent}% used)`
    )
    if (bonus > 0) tooltipLines.push(`${bonus} bonus credits`)
    if (resetText) tooltipLines.push(resetText)
  }
  const tooltipText = tooltipLines.join(' · ')

  return (
    <Tooltip content={tooltipText}>
      <Badge variant='secondary' className={cn('text-xs cursor-default', className)}>
        {isUnlimited ? (
          'Unlimited'
        ) : (
          <>
            {totalRemaining}
            <span className='ms-1 font-semibold'>credits</span>
          </>
        )}
      </Badge>
    </Tooltip>
  )
}

export default BadgeAiQuota
