// apps/web/src/components/data-import/plan-preview/strategy-row.tsx

'use client'

import { Badge, type Variant } from '@auxx/ui/components/badge'
import { EntityIcon } from '~/components/pickers/icon-picker'

type StrategyType = 'create' | 'update' | 'skip'

interface StrategyRowProps {
  strategy: StrategyType
  count: number
  description: string
}

/**
 * Row showing a single import strategy.
 */
export function StrategyRow({ strategy, count, description }: StrategyRowProps) {
  const config = getStrategyConfig(strategy)

  return (
    <div className="group flex items-center justify-between rounded-2xl border py-2 px-3 hover:bg-muted transition-colors duration-200">
      <div className="flex items-center gap-3">
        <EntityIcon iconId={config.iconId} color={config.color} />
        <div className="flex flex-col">
          <span className="text-sm font-medium">{config.label}</span>
          <span className="text-xs text-muted-foreground">{description}</span>
        </div>
      </div>
      <Badge variant={config.badgeVariant}>{count.toLocaleString()} rows</Badge>
    </div>
  )
}

/**
 * Get visual configuration for each strategy type.
 */
function getStrategyConfig(strategy: StrategyType): {
  label: string
  iconId: string
  color: string
  badgeVariant: Variant
} {
  switch (strategy) {
    case 'create':
      return {
        label: 'Create New Records',
        iconId: 'plus',
        color: 'green',
        badgeVariant: 'green',
      }
    case 'update':
      return {
        label: 'Update Existing',
        iconId: 'refresh',
        color: 'blue',
        badgeVariant: 'blue',
      }
    case 'skip':
      return {
        label: 'Skip Rows',
        iconId: 'ban',
        color: 'gray',
        badgeVariant: 'gray',
      }
  }
}
