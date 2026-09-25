// apps/web/src/components/mrp/ui/suppliers/use-supplier-draft.ts

'use client'

import { PermissionKey } from '@auxx/lib/permissions/client'
import { toastError } from '@auxx/ui/components/toast'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { refusalsByName } from '../rows/mrp-bulk-bar'

/** One draft PO for a supplier's lines via `mrp.createDraftPurchaseOrders`; refusals and errors toast. */
export function useSupplierDraft(runId: string | null | undefined, nameOf: (id: string) => string) {
  const utils = api.useUtils()
  const { can } = useAccess()
  const canManage = can(PermissionKey.mrpManage)
  const create = api.mrp.createDraftPurchaseOrders.useMutation()

  /** Resolves to the created POs, empty on refusal or error. */
  const draft = async (
    items: Array<{ partId: string; quantity?: number; vendorPartId?: string }>
  ): Promise<Array<{ purchaseOrderId: string }>> => {
    if (items.length === 0) return []
    try {
      const result = await create.mutateAsync({ runId: runId ?? undefined, items })
      if (result.refused.length > 0)
        toastError({
          title: 'Some parts were not drafted',
          description: refusalsByName(result.refused, nameOf)
            .map((refusal) => refusal.label)
            .join('; '),
        })
      void utils.mrp.list.invalidate()
      void utils.mrp.summary.invalidate()
      void utils.mrp.supplierNextOrder.invalidate()
      return result.created
    } catch (error) {
      toastError({
        title: 'Could not create the draft PO',
        description: error instanceof Error ? error.message : undefined,
      })
      return []
    }
  }

  return { draft, canManage, isPending: create.isPending }
}
