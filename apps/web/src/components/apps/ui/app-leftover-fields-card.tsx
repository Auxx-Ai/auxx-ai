// apps/web/src/components/apps/ui/app-leftover-fields-card.tsx
'use client'

import { Banner } from '@auxx/ui/components/banner'
import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { Eraser } from 'lucide-react'
import { useConfirm } from '~/hooks/use-confirm'
import { api } from '~/trpc/react'

interface AppLeftoverFieldsCardProps {
  appSlug: string
  appTitle: string
}

/**
 * Offer to remove the columns an uninstalled app left behind
 * (plans/money/tasks/44 D-5).
 *
 * Uninstall keeps them on purpose: a reinstall reactivates the SAME `AppInstallation`
 * row, so a still-stamped column is re-adopted by `(appInstallationId, appFieldKey)`
 * with its values intact — the alternative to preserving them is a full re-sync to
 * rebuild them.
 *
 * 🛑 But they survive FROZEN. `isProtectedField` is `!!systemAttribute ||
 * !!appInstallationId` and the stamp outlives the uninstall, so `updateCustomField` and
 * `deleteCustomField` both refuse them, and every one is `isUpdatable: false`. Without
 * this action the merchant holds columns they can see, cannot edit and cannot delete,
 * from an app that is gone. Keeping them is the right default; it must not be a one-way
 * door.
 *
 * Renders nothing unless an UNINSTALLED installation still owns columns — a reinstall
 * makes the query return null and the card disappears on its own.
 */
export function AppLeftoverFieldsCard({ appSlug, appTitle }: AppLeftoverFieldsCardProps) {
  const utils = api.useUtils()
  const [confirm, ConfirmDialog] = useConfirm()
  const leftover = api.apps.leftoverFields.useQuery({ appSlug })

  const removeLeftoverFields = api.apps.removeLeftoverFields.useMutation({
    onSuccess: async () => {
      await utils.apps.leftoverFields.invalidate({ appSlug })
    },
    onError: (error) => {
      toastError({ title: 'Failed to remove fields', description: error.message })
    },
  })

  const data = leftover.data
  if (!data?.appInstallationId || data.fields === 0) return null

  const fields = `${data.fields} ${data.fields === 1 ? 'field' : 'fields'}`
  // The hidden/visible split matters here: most of what is left is bookkeeping the
  // merchant never sees, and a bare field count reads as far more than it is.
  const visible =
    data.visible === 0
      ? 'none of them visible on your records'
      : `${data.visible} visible on your records`

  const onRemove = async () => {
    const confirmed = await confirm({
      title: `Remove ${appTitle} fields?`,
      description: `${fields} and ${data.values.toLocaleString()} ${
        data.values === 1 ? 'value' : 'values'
      } are permanently deleted. Reinstalling ${appTitle} will re-create the fields, but their values only come back from a fresh sync. This cannot be undone.`,
      confirmText: 'Remove fields',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (confirmed) removeLeftoverFields.mutate({ appSlug })
  }

  return (
    <>
      <Banner
        variant='info'
        icon={<Eraser />}
        title={`${appTitle} left ${fields} behind`}
        action={
          <Button
            variant='outline'
            size='xs'
            loading={removeLeftoverFields.isPending}
            loadingText='Removing...'
            onClick={() => void onRemove()}>
            Remove fields
          </Button>
        }>
        {data.values.toLocaleString()} {data.values === 1 ? 'value is' : 'values are'} still stored
        on your records ({visible}). They are kept so reinstalling {appTitle} restores them
        instantly — remove them if you are not coming back.
      </Banner>
      <ConfirmDialog />
    </>
  )
}
