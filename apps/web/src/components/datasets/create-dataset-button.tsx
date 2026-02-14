// apps/web/src/components/datasets/create-dataset-button.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import { Plus } from 'lucide-react'
import { CreateDatasetDialog } from './create-dataset-dialog'

/**
 * Button to trigger dataset creation dialog
 */
export function CreateDatasetButton({
  variant = 'default',
}: {
  variant?: 'default' | 'outline'
} = {}) {
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
