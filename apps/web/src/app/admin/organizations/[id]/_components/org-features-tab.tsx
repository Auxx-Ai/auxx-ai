// apps/web/src/app/admin/organizations/[id]/_components/org-features-tab.tsx
'use client'

import type { FeatureDefinition, FeatureLimit } from '@auxx/lib/permissions/client'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Skeleton } from '@auxx/ui/components/skeleton'
import { toastError } from '@auxx/ui/components/toast'
import { RotateCcw, Save } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { FeatureLimitsCard } from '~/app/admin/_components/features'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

interface OrgFeaturesTabProps {
  organizationId: string
  currentPlan: string | null
}

/** Convert a Record<string, FeatureLimit> to FeatureDefinition[] */
function recordToDefinitions(record: Record<string, FeatureLimit>): FeatureDefinition[] {
  return Object.entries(record).map(([key, value]) => ({
    key,
    limit: value === '+' ? -1 : value,
  }))
}

/**
 * Normalize plan defaults — could be FeatureDefinition[] (from DB) or Record<string, FeatureLimit>.
 * The DB stores featureLimits as a JSON array of {key, limit} objects.
 */
function normalizePlanDefaults(raw: unknown): FeatureDefinition[] {
  if (!raw) return []
  if (Array.isArray(raw)) {
    return raw.map((item: FeatureDefinition) => ({
      key: item.key,
      limit: item.limit === '+' ? -1 : item.limit,
    }))
  }
  return recordToDefinitions(raw as Record<string, FeatureLimit>)
}

/** Convert limits array to a record for the API — saves all explicit overrides */
function limitsToRecord(limits: FeatureDefinition[]): Record<string, number | boolean> {
  const record: Record<string, number | boolean> = {}
  for (const { key, limit } of limits) {
    record[key] = limit === '+' ? -1 : (limit as number | boolean)
  }
  return record
}

export function OrgFeaturesTab({ organizationId, currentPlan }: OrgFeaturesTabProps) {
  const [confirm, ConfirmDialog] = useConfirm()
  const [limits, setLimits] = useState<FeatureDefinition[]>([])
  const [trialMode, setTrialMode] = useState(false)
  const initialLimitsRef = useRef<string>('')
  const utils = api.useUtils()

  const { data, isLoading } = api.admin.billing.getFeatureLimits.useQuery({ organizationId })

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

  // Initialize local state from query data — only overrides go into `limits`
  useEffect(() => {
    if (data) {
      const overrides = data.customOverrides
        ? recordToDefinitions(data.customOverrides as Record<string, FeatureLimit>)
        : []
      setLimits(overrides)
      initialLimitsRef.current = JSON.stringify(overrides)
    }
  }, [data])

  const planDefaults = trialMode
    ? normalizePlanDefaults(data?.planTrialDefaults ?? data?.planDefaults)
    : normalizePlanDefaults(data?.planDefaults)

  const hasAnyOverrides =
    data?.customOverrides && Object.keys(data.customOverrides as Record<string, unknown>).length > 0

  const isDirty = JSON.stringify(limits) !== initialLimitsRef.current

  const handleSave = () => {
    const overrides = limitsToRecord(limits)
    configureLimits.mutate({ organizationId, limits: overrides })
  }

  const handleClear = async () => {
    const confirmed = await confirm({
      title: 'Clear All Overrides?',
      description: 'This will remove all custom feature overrides and revert to the plan defaults.',
      confirmText: 'Clear Overrides',
      cancelText: 'Cancel',
      destructive: true,
    })

    if (confirmed) {
      clearLimits.mutate({ organizationId })
    }
  }

  if (isLoading) {
    return (
      <div className='p-4 space-y-3'>
        <Skeleton className='h-8 w-48' />
        <Skeleton className='h-64 w-full' />
      </div>
    )
  }

  return (
    <>
      <ConfirmDialog />
      <div className='flex-1 flex flex-col min-h-0 overflow-y-auto'>
        <FeatureLimitsCard
          limits={limits}
          onChange={setLimits}
          planDefaults={planDefaults}
          overrideMode
          trialMode={trialMode}
          onTrialModeChange={setTrialMode}
          showTrialToggle={data?.hasTrial}
        />

        {/* Actions */}
        <div className='flex items-center gap-2 px-6 pb-6'>
          <Button onClick={handleSave} loading={configureLimits.isPending} disabled={!isDirty}>
            <Save />
            Save Custom Limits
          </Button>
          {hasAnyOverrides && (
            <Button variant='outline' onClick={handleClear} loading={clearLimits.isPending}>
              <RotateCcw />
              Clear All Overrides
            </Button>
          )}
          {currentPlan && (
            <span className='ml-auto text-sm text-muted-foreground'>
              Plan: <span className='font-medium'>{currentPlan}</span>
              {data?.isTrialing && (
                <Badge variant='secondary' className='ml-2'>
                  Trialing
                </Badge>
              )}
            </span>
          )}
        </div>
      </div>
    </>
  )
}
