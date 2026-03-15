// apps/web/src/app/admin/_components/features/static-limits-card.tsx
/**
 * Static limit numeric inputs, driven by FEATURE_REGISTRY.
 * Shared between plan editing and per-org overrides.
 */
'use client'

import type { FeatureDefinition } from '@auxx/lib/permissions/client'
import { FEATURE_REGISTRY } from '@auxx/lib/permissions/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Input } from '@auxx/ui/components/input'

interface StaticLimitsCardProps {
  limits: FeatureDefinition[]
  onChange: (limits: FeatureDefinition[]) => void
  planDefaults?: FeatureDefinition[]
}

const STATIC_FEATURES = FEATURE_REGISTRY.filter((f) => f.type === 'static')

export function StaticLimitsCard({ limits, onChange, planDefaults }: StaticLimitsCardProps) {
  const getNumericLimit = (key: string): number | undefined => {
    const val = limits.find((l) => l.key === key)?.limit
    return typeof val === 'number' ? val : undefined
  }

  const isConfigured = (key: string): boolean => {
    return limits.some((l) => l.key === key)
  }

  const updateLimit = (key: string, value: number) => {
    const existing = limits.find((l) => l.key === key)
    if (existing) {
      onChange(limits.map((l) => (l.key === key ? { ...l, limit: value } : l)))
    } else {
      onChange([...limits, { key, limit: value }])
    }
  }

  const enableLimit = (key: string) => {
    onChange([...limits, { key, limit: 0 }])
  }

  const removeLimit = (key: string) => {
    onChange(limits.filter((l) => l.key !== key))
  }

  const toggleUnlimited = (key: string) => {
    const current = getNumericLimit(key)
    if (current === -1) {
      updateLimit(key, 0)
    } else {
      updateLimit(key, -1)
    }
  }

  return (
    <Card className='border-none rounded-none shadow-none'>
      <CardHeader>
        <CardTitle className='text-lg'>Static Limits</CardTitle>
      </CardHeader>
      <CardContent>
        <div className='space-y-3'>
          {STATIC_FEATURES.map(({ key, label, unit }) => {
            const configured = isConfigured(key)
            const value = getNumericLimit(key)
            const isUnlimited = value === -1

            if (!configured) {
              return (
                <div
                  key={key}
                  className='flex items-center justify-between py-2 px-3 rounded-md bg-muted/30'>
                  <div className='flex flex-col'>
                    <span className='text-sm font-medium text-muted-foreground'>{label}</span>
                    <span className='text-xs text-muted-foreground'>Not configured</span>
                  </div>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => enableLimit(key)}>
                    Enable
                  </Button>
                </div>
              )
            }

            return (
              <div
                key={key}
                className='flex items-center justify-between py-2 px-3 rounded-md hover:bg-muted/50'>
                <div className='flex flex-col'>
                  <span className='text-sm font-medium'>{label}</span>
                  {unit && <span className='text-xs text-muted-foreground'>{unit}</span>}
                </div>
                <div className='flex items-center gap-2'>
                  {isUnlimited ? (
                    <Badge variant='secondary' className='font-mono'>
                      ∞
                    </Badge>
                  ) : (
                    <Input
                      type='number'
                      value={value ?? 0}
                      onChange={(e) => updateLimit(key, Number.parseInt(e.target.value, 10) || 0)}
                      className='w-24 h-8 text-sm'
                    />
                  )}
                  <Button
                    type='button'
                    variant={isUnlimited ? 'secondary' : 'outline'}
                    size='sm'
                    className='text-xs h-8'
                    onClick={() => toggleUnlimited(key)}>
                    {isUnlimited ? 'Limited' : '∞'}
                  </Button>
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    className='text-xs h-8 text-muted-foreground'
                    onClick={() => removeLimit(key)}>
                    Reset
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
