'use client'
import type { UserSettings } from '@auxx/lib/settings/types'
import { Switch } from '@auxx/ui/components/switch'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import React from 'react'
import { api } from '~/trpc/react'
import { isActionError } from '~/utils/error'

type Props = { settings: UserSettings }

function AutoSyncSwitch({ settings }: Props) {
  const updateSetting = api.user.updateSetting.useMutation()

  const [isChecked, setIsChecked] = React.useState(settings.shopify.autoSync)
  const [isUpdating, setIsUpdating] = React.useState(false)

  const handleAutoSync = async (value: boolean) => {
    setIsChecked((v) => !v)

    setIsUpdating(true)
    const result = await updateSetting.mutateAsync({ path: 'shopify.autoSync', value: value })
    if (isActionError(result)) {
      toastError({ description: 'Failed to auto sync' })
    } else {
      toastSuccess({ description: 'Auto sync updated' })
    }
    setIsUpdating(false)
  }

  return <Switch checked={isChecked} onCheckedChange={handleAutoSync} disabled={isUpdating} />
}

export default AutoSyncSwitch
