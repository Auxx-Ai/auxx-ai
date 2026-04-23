// apps/web/src/components/ai/ui/credit-multiplier-badge.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { Tooltip } from '~/components/global/tooltip'

type CreditMultiplier = 1 | 3 | 5

const TIER_LABEL: Record<CreditMultiplier, string> = {
  1: 'Small tier',
  3: 'Medium tier',
  5: 'Large tier',
}

interface CreditMultiplierBadgeProps {
  multiplier: CreditMultiplier
  className?: string
}

/**
 * Small badge that shows how many credits one call to this model consumes
 * from the org's AI credit pool. Tooltip explains the tier.
 */
export const CreditMultiplierBadge = ({ multiplier, className }: CreditMultiplierBadgeProps) => {
  const creditsLabel = multiplier === 1 ? '1 credit' : `${multiplier} credits`
  return (
    <Tooltip
      content={`${TIER_LABEL[multiplier]} — each call uses ${creditsLabel} from your AI credit pool.`}>
      <div
        className={cn(
          'flex items-center px-1 h-[18px] rounded-[5px] border border-border text-[10px] font-medium text-muted-foreground cursor-default shrink-0',
          className
        )}>
        ×{multiplier}
      </div>
    </Tooltip>
  )
}
