// apps/web/src/components/ai/ui/model-cost-badge.tsx

'use client'

import {
  type CostPer1kTokens,
  creditsPer1kInputTokens,
  creditsPer1kOutputTokens,
  getModelCostTier,
} from '@auxx/lib/ai/quota/client'
import { cn } from '@auxx/ui/lib/utils'
import { Tooltip } from '~/components/global/tooltip'

const TIER_LABEL = {
  $: 'Low cost',
  $$: 'Mid cost',
  $$$: 'High cost',
} as const

interface ModelCostBadgeProps {
  costPer1kTokens?: CostPer1kTokens | null
  className?: string
}

/**
 * Relative price tier (`$`/`$$`/`$$$`) bucketed from a model's blended list
 * price. Tooltip shows the exact credit rates — clean integers at this
 * conversion (cost × 10,000). No per-call estimate: real call cost is
 * context-dominated, so a fixed number would mislead.
 */
export const ModelCostBadge = ({ costPer1kTokens, className }: ModelCostBadgeProps) => {
  if (!costPer1kTokens) return null

  const tier = getModelCostTier(costPer1kTokens)
  // Per-token credit rates (the per-1k value / 1000), trimmed of trailing zeros.
  const perToken = (creditsPer1k: number) => Number((creditsPer1k / 1000).toFixed(4)).toString()
  const inputRate = perToken(creditsPer1kInputTokens(costPer1kTokens))
  const outputRate = perToken(creditsPer1kOutputTokens(costPer1kTokens))

  return (
    <Tooltip
      contentComponent={
        <span className='flex flex-col gap-0.5 text-center'>
          <span>{TIER_LABEL[tier]}</span>
          <span>
            <span className='font-mono font-medium'>{inputRate}</span>
            <span className='opacity-70'> cred/tok in</span>
            <span className='opacity-40'> · </span>
            <span className='font-mono font-medium'>{outputRate}</span>
            <span className='opacity-70'> out</span>
          </span>
          <span className='opacity-70'>Charged on actual usage.</span>
        </span>
      }>
      <div
        className={cn(
          'flex items-center px-1 h-[18px] rounded-[5px] border text-[10px] font-semibold cursor-default shrink-0',
          'text-green-700 bg-lime-50 border-black/10',
          'dark:text-green-300 dark:bg-green-950/40 dark:border-white/10',
          className
        )}>
        {tier}
      </div>
    </Tooltip>
  )
}
