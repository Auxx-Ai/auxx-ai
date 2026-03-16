// apps/web/src/components/datasets/create-dataset-button.tsx

'use client'

import { FeatureKey } from '@auxx/lib/permissions/client'
import { Button } from '@auxx/ui/components/button'
import { Database, Plus } from 'lucide-react'
import { useState } from 'react'
import { LimitReachedDialog } from '~/components/subscriptions/limit-reached-dialog'
import { useFeatureFlags } from '~/providers/feature-flag-provider'
import { CreateDatasetDialog } from './create-dataset-dialog'
import { useDatasets } from './datasets-provider'

/**
 * Button to trigger dataset creation dialog
 */
export function CreateDatasetButton({
  variant = 'default',
}: {
  variant?: 'default' | 'outline'
} = {}) {
  const [limitDialogOpen, setLimitDialogOpen] = useState(false)
  const { isAtLimit, getLimit } = useFeatureFlags()
  const { stats } = useDatasets()
  const atLimit = isAtLimit(FeatureKey.datasetsLimit, stats?.total ?? 0)
  const datasetLimit = getLimit(FeatureKey.datasetsLimit)

  if (atLimit) {
    return (
      <>
        <Button variant={variant} size='sm' onClick={() => setLimitDialogOpen(true)}>
          <Plus />
          Create Dataset
        </Button>
        <LimitReachedDialog
          open={limitDialogOpen}
          onOpenChange={setLimitDialogOpen}
          icon={Database}
          title='Dataset Limit Reached'
          description={`You've reached the maximum of ${datasetLimit} datasets on your current plan.`}
        />
      </>
    )
  }

  return (
    <CreateDatasetDialog
      trigger={
        <Button variant={variant} size='sm'>
          <Plus />
          Create Dataset
        </Button>
      }
    />
  )
}
