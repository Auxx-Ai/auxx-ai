// apps/web/src/app/admin/_components/features/usage-limits-card.tsx
/**
 * Paired hard/soft usage limit inputs grouped by metric, driven by FEATURE_REGISTRY.
 * Shared between plan editing and per-org overrides.
 */
'use client'

import type { FeatureDefinition } from '@auxx/lib/permissions/client'
import { FEATURE_REGISTRY, USAGE_METRICS } from '@auxx/lib/permissions/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@auxx/ui/components/card'
import { Input } from '@auxx/ui/components/input'
import { Plus, X } from 'lucide-react'
import { useState } from 'react'

interface UsageLimitsCardProps {
  limits: FeatureDefinition[]
  onChange: (limits: FeatureDefinition[]) => void
  planDefaults?: FeatureDefinition[]
}

/** All known feature keys for filtering custom limits */
const ALL_KNOWN_KEYS = new Set(FEATURE_REGISTRY.map((f) => f.key))

/** Get usage feature pairs grouped by metric */
function getUsageGroups() {
  return USAGE_METRICS.map((metric) => {
    const features = FEATURE_REGISTRY.filter((f) => f.type === 'usage' && f.metric === metric)
    const hard = features.find((f) => f.variant === 'hard')!
    const soft = features.find((f) => f.variant === 'soft')!
    return { metric, label: hard.label, unit: hard.unit, hard, soft }
  })
}

const USAGE_GROUPS = getUsageGroups()

export function UsageLimitsCard({ limits, onChange, planDefaults }: UsageLimitsCardProps) {
  const [customKey, setCustomKey] = useState('')
  const [customLimit, setCustomLimit] = useState<number>(0)

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

  const removeLimit = (key: string) => {
    onChange(limits.filter((l) => l.key !== key))
  }

  const enableMetric = (hardKey: string, softKey: string) => {
    const newLimits = [...limits]
    if (!isConfigured(hardKey)) newLimits.push({ key: hardKey, limit: 0 })
    if (!isConfigured(softKey)) newLimits.push({ key: softKey, limit: 0 })
    onChange(newLimits)
  }

  const removeMetric = (hardKey: string, softKey: string) => {
    onChange(limits.filter((l) => l.key !== hardKey && l.key !== softKey))
  }

  const toggleUnlimited = (key: string) => {
    const current = getNumericLimit(key)
    if (current === -1) {
      updateLimit(key, 0)
    } else {
      updateLimit(key, -1)
    }
  }

  const addCustomLimit = () => {
    if (customKey.trim() && !limits.find((l) => l.key === customKey)) {
      onChange([...limits, { key: customKey.trim(), limit: customLimit }])
      setCustomKey('')
      setCustomLimit(0)
    }
  }

  const customLimits = limits.filter((l) => !ALL_KNOWN_KEYS.has(l.key))

  return (
    <Card className='border-none rounded-none shadow-none'>
      <CardHeader>
        <CardTitle className='text-lg'>Usage Limits</CardTitle>
        <CardDescription>Per billing cycle limits with soft/hard thresholds</CardDescription>
      </CardHeader>
      <CardContent>
        <div className='space-y-4'>
          {USAGE_GROUPS.map(({ metric, label, unit, hard, soft }) => {
            const hardConfigured = isConfigured(hard.key)
            const softConfigured = isConfigured(soft.key)
            const metricConfigured = hardConfigured || softConfigured
            const hardValue = getNumericLimit(hard.key)
            const hardIsUnlimited = hardValue === -1

            if (!metricConfigured) {
              return (
                <div
                  key={metric}
                  className='flex items-center justify-between py-3 px-3 rounded-md bg-muted/30'>
                  <div className='flex flex-col'>
                    <span className='text-sm font-medium text-muted-foreground'>{label}</span>
                    <span className='text-xs text-muted-foreground'>Not configured</span>
                  </div>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    onClick={() => enableMetric(hard.key, soft.key)}>
                    Enable
                  </Button>
                </div>
              )
            }

            return (
              <div key={metric} className='rounded-md border p-3 space-y-2'>
                <div className='flex items-center justify-between'>
                  <div className='flex items-center gap-2'>
                    <span className='text-sm font-medium'>{label}</span>
                    {unit && <span className='text-xs text-muted-foreground'>{unit}</span>}
                  </div>
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    className='text-xs text-muted-foreground h-7'
                    onClick={() => removeMetric(hard.key, soft.key)}>
                    <X className='h-3 w-3' />
                    Remove
                  </Button>
                </div>

                {/* Hard limit */}
                <div className='flex items-center gap-2 pl-2'>
                  <span className='text-xs text-muted-foreground w-10'>Hard</span>
                  {hardIsUnlimited ? (
                    <Badge variant='secondary' className='font-mono'>
                      ∞
                    </Badge>
                  ) : (
                    <Input
                      type='number'
                      value={hardValue ?? 0}
                      onChange={(e) =>
                        updateLimit(hard.key, Number.parseInt(e.target.value, 10) || 0)
                      }
                      className='w-24 h-8 text-sm'
                    />
                  )}
                  <Button
                    type='button'
                    variant={hardIsUnlimited ? 'secondary' : 'outline'}
                    size='sm'
                    className='text-xs h-7'
                    onClick={() => toggleUnlimited(hard.key)}>
                    {hardIsUnlimited ? 'Limited' : '∞'}
                  </Button>
                </div>

                {/* Soft limit — hidden when hard is unlimited */}
                {!hardIsUnlimited && (
                  <div className='flex items-center gap-2 pl-2'>
                    <span className='text-xs text-muted-foreground w-10'>Soft</span>
                    <Input
                      type='number'
                      value={getNumericLimit(soft.key) ?? 0}
                      onChange={(e) =>
                        updateLimit(soft.key, Number.parseInt(e.target.value, 10) || 0)
                      }
                      className='w-24 h-8 text-sm'
                    />
                  </div>
                )}
              </div>
            )
          })}

          {/* Custom limits */}
          {customLimits.length > 0 && (
            <div className='pt-2 border-t space-y-2'>
              <span className='text-sm font-medium'>Custom Limits</span>
              {customLimits.map((limit) => (
                <div
                  key={limit.key}
                  className='flex items-center gap-2 py-1 px-3 bg-muted rounded-md'>
                  <span className='flex-1 text-sm font-mono'>{limit.key}</span>
                  <Input
                    type='number'
                    value={typeof limit.limit === 'number' ? limit.limit : 0}
                    onChange={(e) =>
                      updateLimit(limit.key, Number.parseInt(e.target.value, 10) || 0)
                    }
                    className='w-24 h-8 text-sm'
                  />
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    onClick={() => removeLimit(limit.key)}>
                    <X className='h-3 w-3' />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Add custom limit */}
          <div className='pt-2 border-t'>
            <span className='text-xs font-medium text-muted-foreground'>Add Custom Limit</span>
            <div className='flex items-center gap-2 mt-1'>
              <Input
                value={customKey}
                onChange={(e) => setCustomKey(e.target.value)}
                placeholder='customKey'
                className='flex-1 h-8 text-sm'
              />
              <Input
                type='number'
                value={customLimit}
                onChange={(e) => setCustomLimit(Number.parseInt(e.target.value, 10) || 0)}
                placeholder='0'
                className='w-24 h-8 text-sm'
              />
              <Button type='button' onClick={addCustomLimit} size='sm' className='h-8'>
                <Plus className='h-3 w-3' />
                Add
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
