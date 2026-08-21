// apps/web/src/components/data-import/plan-preview/strategy-cell.tsx

'use client'

import type { StrategyType } from '@auxx/lib/import/client'
import { Badge, type Variant } from '@auxx/ui/components/badge'
import { Ban, Plus, RefreshCw, SearchX } from 'lucide-react'

/**
 * Config for each strategy type.
 *
 * Four entries, and `skip` / `unmatched` must never share one. `skip` is
 * *"this row has an error"*; `unmatched` is *"this row is fine, but update-only
 * mode found no record to update"*. Reusing one badge for both hides a whole
 * class of unimported rows behind a state that reads normal.
 */
const STRATEGY_CONFIG: Record<
  StrategyType,
  { label: string; icon: typeof Plus; variant: Variant; hint?: string }
> = {
  create: { label: 'Create', icon: Plus, variant: 'emerald' },
  update: { label: 'Update', icon: RefreshCw, variant: 'blue' },
  skip: { label: 'Skip', icon: Ban, variant: 'amber' },
  unmatched: {
    label: 'Unmatched',
    icon: SearchX,
    variant: 'zinc',
    hint: 'No existing record matched this row, and the import is set to update only. The row will not be imported.',
  },
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
  const { label, icon: Icon, variant, hint } = STRATEGY_CONFIG[strategy]
  const errorText = errors.join(', ')
  const showErrors = strategy === 'skip' && errors.length > 0

  return (
    <div className='flex items-center gap-2 px-3'>
      <Badge variant={variant} title={showErrors ? errorText : hint}>
        <Icon />
        {label}
      </Badge>
      {showErrors && (
        <span className='text-xs text-muted-foreground truncate max-w-[200px]' title={errorText}>
          {errors[0]}
        </span>
      )}
      {strategy === 'unmatched' && (
        <span className='text-xs text-muted-foreground truncate max-w-[200px]' title={hint}>
          No matching record
        </span>
      )}
    </div>
  )
}
