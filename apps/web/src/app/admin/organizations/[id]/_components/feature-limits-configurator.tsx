// apps/web/src/app/admin/organizations/[id]/_components/feature-limits-configurator.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Card } from '@auxx/ui/components/card'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { Infinity, RotateCcw, Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '~/trpc/react'

interface FeatureLimitsConfiguratorProps {
  organizationId: string
}

/** Feature definitions with labels and descriptions */
const FEATURE_DEFINITIONS = [
  {
    key: 'TEAMMATES',
    label: 'Team Members',
    description: 'Maximum number of active team members',
  },
  {
    key: 'CHANNELS',
    label: 'Channels',
    description: 'Maximum number of connected inboxes/channels',
  },
  {
    key: 'MONTHLY_EMAILS',
    label: 'Monthly Emails',
    description: 'Maximum emails processed per month',
  },
  {
    key: 'AI_REQUESTS',
    label: 'AI Requests',
    description: 'Maximum AI requests per month',
  },
]

/**
 * Feature limits configurator for Enterprise customers
 */
export function FeatureLimitsConfigurator({ organizationId }: FeatureLimitsConfiguratorProps) {
  const [limits, setLimits] = useState<Record<string, number>>({})
  const [unlimited, setUnlimited] = useState<Record<string, boolean>>({})
  const utils = api.useUtils()

  const { data: featureLimits, isLoading } = api.admin.billing.getFeatureLimits.useQuery({
    organizationId,
  })

  const configureLimits = api.admin.billing.configureCustomLimits.useMutation({
    onSuccess: () => {
      utils.admin.billing.getFeatureLimits.invalidate({ organizationId })
      utils.admin.getOrganization.invalidate({ id: organizationId })
    },
    onError: (error) =>
      toastError({ title: 'Failed to update limits', description: error.message }),
  })

  const clearLimits = api.admin.billing.clearCustomLimits.useMutation({
    onSuccess: () => {
      utils.admin.billing.getFeatureLimits.invalidate({ organizationId })
      utils.admin.getOrganization.invalidate({ id: organizationId })
    },
    onError: (error) => toastError({ title: 'Failed to clear limits', description: error.message }),
  })

  /**
   * Initialize limits from query data
   */
  useEffect(() => {
    if (featureLimits) {
      const initialLimits: Record<string, number> = {}
      const initialUnlimited: Record<string, boolean> = {}

      for (const feature of FEATURE_DEFINITIONS) {
        const effectiveLimit = featureLimits.effectiveLimits[feature.key]
        const isUnlimited = effectiveLimit === -1 || effectiveLimit === '+'

        initialUnlimited[feature.key] = isUnlimited
        initialLimits[feature.key] = isUnlimited
          ? 0
          : typeof effectiveLimit === 'number'
            ? effectiveLimit
            : 0
      }

      setLimits(initialLimits)
      setUnlimited(initialUnlimited)
    }
  }, [featureLimits])

  /**
   * Handle save custom limits
   */
  const handleSave = () => {
    const finalLimits: Record<string, number> = {}

    for (const feature of FEATURE_DEFINITIONS) {
      finalLimits[feature.key] = unlimited[feature.key] ? -1 : limits[feature.key] || 0
    }

    configureLimits.mutate({
      organizationId,
      limits: finalLimits,
    })
  }

  /**
   * Handle clear all custom limits
   */
  const handleClear = () => {
    clearLimits.mutate({ organizationId })
  }

  /**
   * Get plan default for a feature
   */
  const getPlanDefault = (featureKey: string): string => {
    if (!featureLimits?.planDefaults) return 'None'

    const planDefaults = featureLimits.planDefaults as any
    if (Array.isArray(planDefaults)) {
      const feature = planDefaults.find((f: any) => f.key === featureKey)
      const limit = feature?.limit
      if (limit === -1 || limit === '+') return 'Unlimited'
      if (typeof limit === 'number') return limit.toString()
      return 'None'
    }

    const limit = planDefaults[featureKey]
    if (limit === -1 || limit === '+') return 'Unlimited'
    if (typeof limit === 'number') return limit.toString()
    return 'None'
  }

  /**
   * Check if feature has custom override
   */
  const hasOverride = (featureKey: string): boolean => {
    if (!featureLimits?.customOverrides) return false
    const overrides = featureLimits.customOverrides as any
    return overrides[featureKey] !== undefined
  }

  if (isLoading) {
    return (
      <div className='space-y-3'>
        <Skeleton className='h-24 w-full' />
        <Skeleton className='h-24 w-full' />
        <Skeleton className='h-24 w-full' />
      </div>
    )
  }

  const hasAnyOverrides =
    featureLimits?.customOverrides && Object.keys(featureLimits.customOverrides as any).length > 0

  return (
    <div className='space-y-4'>
      <div className='grid gap-4'>
        {FEATURE_DEFINITIONS.map((feature) => {
          const planDefault = getPlanDefault(feature.key)
          const isOverridden = hasOverride(feature.key)

          return (
            <Card key={feature.key} className='p-4'>
              <div className='space-y-3'>
                <div className='flex items-start justify-between'>
                  <div className='flex-1'>
                    <div className='flex items-center gap-2'>
                      <Label className='text-base font-medium'>{feature.label}</Label>
                      {isOverridden && (
                        <Badge variant='secondary' className='text-xs'>
                          Custom
                        </Badge>
                      )}
                    </div>
                    <p className='text-sm text-muted-foreground mt-1'>{feature.description}</p>
                    <p className='text-xs text-muted-foreground mt-1'>
                      Plan default: <span className='font-medium'>{planDefault}</span>
                    </p>
                  </div>
                </div>

                <div className='flex items-center gap-4'>
                  <div className='flex-1'>
                    <Input
                      type='number'
                      min='0'
                      value={limits[feature.key] || 0}
                      onChange={(e) =>
                        setLimits({ ...limits, [feature.key]: parseInt(e.target.value) || 0 })
                      }
                      disabled={unlimited[feature.key]}
                      placeholder='Enter limit'
                    />
                  </div>
                  <div className='flex items-center space-x-2'>
                    <Checkbox
                      id={`unlimited-${feature.key}`}
                      checked={unlimited[feature.key]}
                      onCheckedChange={(checked) =>
                        setUnlimited({ ...unlimited, [feature.key]: checked === true })
                      }
                    />
                    <Label
                      htmlFor={`unlimited-${feature.key}`}
                      className='font-normal cursor-pointer flex items-center gap-1'>
                      <Infinity className='size-3' />
                      Unlimited
                    </Label>
                  </div>
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      <div className='flex items-center gap-2 pt-2'>
        <Button onClick={handleSave} loading={configureLimits.isPending}>
          <Save />
          Save Custom Limits
        </Button>
        {hasAnyOverrides && (
          <Button variant='outline' onClick={handleClear} loading={clearLimits.isPending}>
            <RotateCcw />
            Reset to Plan Defaults
          </Button>
        )}
      </div>

      {hasAnyOverrides && (
        <div className='p-3 rounded-lg border bg-blue-50 dark:bg-blue-950/20 text-sm'>
          <p className='text-blue-700 dark:text-blue-300'>
            <strong>Note:</strong> Custom limits override the plan defaults. Clearing them will
            restore the original plan limits.
          </p>
        </div>
      )}
    </div>
  )
}
