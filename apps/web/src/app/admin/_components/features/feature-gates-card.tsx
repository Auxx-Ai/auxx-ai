// apps/web/src/app/admin/_components/features/feature-gates-card.tsx
/**
 * Boolean feature gate switches, driven by FEATURE_REGISTRY.
 * Shared between plan editing and per-org overrides.
 */
'use client'

import type { FeatureDefinition } from '@auxx/lib/permissions/client'
import { FEATURE_REGISTRY } from '@auxx/lib/permissions/client'
import { Card, CardContent, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Switch } from '@auxx/ui/components/switch'

interface FeatureGatesCardProps {
  limits: FeatureDefinition[]
  onChange: (limits: FeatureDefinition[]) => void
  planDefaults?: FeatureDefinition[]
}

const BOOLEAN_FEATURES = FEATURE_REGISTRY.filter((f) => f.type === 'boolean')

export function FeatureGatesCard({ limits, onChange, planDefaults }: FeatureGatesCardProps) {
  const getBooleanLimit = (key: string): boolean => {
    const val = limits.find((l) => l.key === key)?.limit
    return val === true
  }

  const updateLimit = (key: string, checked: boolean) => {
    const existing = limits.find((l) => l.key === key)
    if (existing) {
      onChange(limits.map((l) => (l.key === key ? { ...l, limit: checked } : l)))
    } else {
      onChange([...limits, { key, limit: checked }])
    }
  }

  return (
    <Card className='border-none rounded-none shadow-none'>
      <CardHeader>
        <CardTitle className='text-lg'>Feature Gates</CardTitle>
      </CardHeader>
      <CardContent>
        <div className='space-y-1'>
          {BOOLEAN_FEATURES.map(({ key, label, group }) => {
            const isEnabled = getBooleanLimit(key)
            const planDefault = planDefaults?.find((l) => l.key === key)
            const isInherited = planDefaults && !limits.find((l) => l.key === key)

            return (
              <div
                key={key}
                className='flex items-center justify-between py-2 px-3 rounded-md hover:bg-muted/50'>
                <div className='flex flex-col'>
                  <span className='text-sm font-medium'>{label}</span>
                  <span className='text-xs text-muted-foreground'>{group}</span>
                </div>
                <div className='flex items-center gap-2'>
                  {isInherited && planDefault && (
                    <span className='text-xs text-muted-foreground'>inherited</span>
                  )}
                  <Switch
                    checked={isEnabled}
                    onCheckedChange={(checked) => updateLimit(key, checked)}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
