// apps/web/src/components/inventory-bridge/hooks/use-inventory-sources.ts

'use client'

import { toastError } from '@auxx/ui/components/toast'
import { api } from '~/trpc/react'

/**
 * List + provision/remove wiring for org-level inventory sources (`api.inventoryBridge`).
 * Provisioning + removal are admin-gated server-side; the section hides the controls for
 * non-admins. Provisioning busts the recordRules cache (the managed rule appears in settings).
 */
export function useInventorySources() {
  const utils = api.useUtils()
  const sources = api.inventoryBridge.sources.useQuery()

  const invalidate = () => {
    void utils.inventoryBridge.sources.invalidate()
    void utils.recordRules.list.invalidate()
  }

  const provision = api.inventoryBridge.provisionSource.useMutation({
    onSuccess: invalidate,
    onError: (error) =>
      toastError({ title: 'Error adding inventory source', description: error.message }),
  })
  const remove = api.inventoryBridge.removeSource.useMutation({
    onSuccess: invalidate,
    onError: (error) =>
      toastError({ title: 'Error removing inventory source', description: error.message }),
  })

  return { sources, provision, remove }
}
