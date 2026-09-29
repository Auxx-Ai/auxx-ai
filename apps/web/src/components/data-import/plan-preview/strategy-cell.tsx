// apps/web/src/components/data-import/plan-preview/strategy-cell.tsx

'use client'

import type { StrategyType } from '@auxx/lib/import/client'
import { Badge, type Variant } from '@auxx/ui/components/badge'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'
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
  skip: { label: 'Skipped', icon: Ban, variant: 'amber' },
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

/** The strategy badge for a preview row; the reason a row is skipped or unmatched sits in its tooltip. */
export function StrategyCell({ strategy, errors = [] }: StrategyCellProps) {
  const { label, icon: Icon, variant, hint } = STRATEGY_CONFIG[strategy]
  const reason = strategy === 'skip' && errors.length > 0 ? errors.join('\n') : hint

  const badge = (
    <Badge variant={variant}>
      <Icon />
      {label}
    </Badge>
  )

  return (
    <div className='flex items-center px-3'>
      {reason ? (
        <SimpleTooltip content={reason}>
          <span className='inline-flex'>{badge}</span>
        </SimpleTooltip>
      ) : (
        badge
      )}
    </div>
  )
}
