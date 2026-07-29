'use client'
// apps/web/src/components/global/buttons/sync-label-button.tsx

import { Button } from '@auxx/ui/components/button'
import { toastError } from '@auxx/ui/components/toast'
import { api } from '~/trpc/react'

/**
 * Kick off a label sync across every channel in the org.
 *
 * Not rendered anywhere yet (kept per `feedback_dont_delete_half_wired_features`).
 * It called `api.label.syncAll`, a procedure that did not exist — the router's
 * `syncAllLabels`→`syncAll` rename makes the call real.
 *
 * Errors only, no success toast (repo convention), and no `isActionError`
 * envelope: `syncAll` throws through `auxxErrorMiddleware` on failure, so a
 * resolved mutation IS success. Per-channel outcomes still come back inside the
 * result array (`{ ok: false, error }`) for a future summary UI.
 */
export function SyncLabelButton() {
  const syncLabels = api.label.syncAll.useMutation({
    onError: (error) => toastError({ title: 'Error syncing labels', description: error.message }),
  })

  return (
    <Button
      variant='outline'
      size='sm'
      loading={syncLabels.isPending}
      loadingText='Syncing...'
      onClick={() => syncLabels.mutate()}>
      Sync Now
    </Button>
  )
}
