// apps/web/src/components/money/ui/invoice/create-invoice-action.tsx
'use client'

// Work-order drawer header action (money MI1 build spec §J.5, the
// create-quote-action precedent): Receipt icon button opening the shared
// `BillingActionDialog` billing-basis router. Always rendered — enablement comes from
// `resolveBillingAction`, the one next-action condition every billing surface shares
// (work-order invoice flow plan §5.3), so this button is only enabled when a new invoice
// can actually be created (not when a draft merely needs review).

import { Button } from '@auxx/ui/components/button'
import { Receipt } from 'lucide-react'
import { useState } from 'react'
import type { DrawerActionProps } from '~/components/drawers/drawer-action-registry'
import { Tooltip } from '~/components/global/tooltip'
import { BillingActionDialog } from '~/components/money/billing/billing-action-dialog'
import { resolveBillingAction } from '~/components/money/billing/types'
import { useWorkOrderBillingState } from '~/components/money/billing/use-work-order-billing-state'

export function CreateInvoiceAction({ recordId }: DrawerActionProps) {
  const [open, setOpen] = useState(false)
  const { billing, isLoading } = useWorkOrderBillingState(recordId)
  const action = resolveBillingAction(billing)
  const canCreate = action.kind === 'create' || action.kind === 'create_extra'

  return (
    <>
      <Tooltip
        content={action.kind === 'create_extra' ? 'Invoice extra work' : 'Create invoice'}
        allowInteraction>
        <Button
          variant='ghost'
          size='icon-xs'
          disabled={isLoading || !canCreate}
          onClick={() => setOpen(true)}>
          <Receipt />
        </Button>
      </Tooltip>
      <BillingActionDialog
        open={open}
        onOpenChange={setOpen}
        scope={{
          kind: 'workOrder',
          workOrderRecordId: recordId,
          billing,
          mode: action.kind === 'create_extra' ? 'extra' : 'primary',
        }}
      />
    </>
  )
}
