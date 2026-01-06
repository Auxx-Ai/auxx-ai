'use client'

import { isActionError } from '~/utils/error'
// import { toastError, toastSuccess } from '../toast'
import { Button } from '@auxx/ui/components/button'
import { api } from '~/trpc/react'
import { useState } from 'react'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { titleize } from '@auxx/utils/strings'
import { WEBAPP_URL } from '@auxx/config/client'

type SyncType = 'orders' | 'products' | 'customers'

export function SyncShopifyButton({ type, label }: { type: SyncType; label?: string }) {
  const syncAction = api.shopify.sync.useMutation()
  const [isLoading, setIsLoading] = useState(false)

  async function handleSync(type: SyncType) {
    setIsLoading(true)
    const res = await fetch(`${WEBAPP_URL}/api/sync/shopify/${type}`)
    const data = await res.json()

    // const result = await syncAction.mutateAsync({ type })
    if (isActionError(data)) {
      toastError({ description: data.error })
    } else {
      toastSuccess({ description: `${titleize(type)} synced successfully` })
    }
    setIsLoading(false)
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={(e) => {
        handleSync(type)
      }}
      disabled={isLoading}>
      {label || 'Sync Now'}
    </Button>
  )
}
