'use client'

import { isActionError } from '~/utils/error'
import { toastError, toastSuccess } from '../toast'
import { Button } from '@auxx/ui/components/button'
import { api } from '~/trpc/react'
import { useState } from 'react'

export function SyncLabelButton() {
  const syncLabels = api.label.syncAll.useMutation()

  const [isLoading, setIsLoading] = useState(false)

  async function handleSyncLabels() {
    setIsLoading(true)
    const result = await syncLabels.mutateAsync()
    if (isActionError(result)) {
      toastError({ description: result.error })
    } else {
      toastSuccess({ description: 'Labels synced successfully' })
    }
    setIsLoading(false)
  }
  return (
    <Button variant="outline" size="sm" onClick={handleSyncLabels} disabled={isLoading}>
      Sync Now
    </Button>
  )
}
