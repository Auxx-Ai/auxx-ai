// apps/web/src/components/data-import/plan-preview/strategy-cell.tsx

'use client'

import type { StrategyType } from '@auxx/lib/import'
import { Badge, type Variant } from '@auxx/ui/components/badge'
import { Ban, Plus, RefreshCw } from 'lucide-react'

/** Config for each strategy type */
const STRATEGY_CONFIG: Record<
  StrategyType,
  { label: string; icon: typeof Plus; variant: Variant }
> = {
  create: { label: 'Create', icon: Plus, variant: 'emerald' },
  update: { label: 'Update', icon: RefreshCw, variant: 'blue' },
  skip: { label: 'Skip', icon: Ban, variant: 'amber' },
}

interface StrategyCellProps {
  strategy: StrategyType
  errors?: string[]
}

/**
 * Displays the strategy badge for a preview row.
 * Shows tooltip with errors for skipped rows.
 */
export function StrategyCell({ strategy, errors = [] }: StrategyCellProps) {
  const { label, icon: Icon, variant } = STRATEGY_CONFIG[strategy]
  const errorText = errors.join(', ')

  return (
    <div className='flex items-center gap-2 px-3'>
      <Badge
        variant={variant}
        title={strategy === 'skip' && errors.length > 0 ? errorText : undefined}>
        <Icon />
        {label}
      </Badge>
      {strategy === 'skip' && errors.length > 0 && (
        <span className='text-xs text-muted-foreground truncate max-w-[200px]' title={errorText}>
          {errors[0]}
        </span>
      )}
    </div>
  )
}
