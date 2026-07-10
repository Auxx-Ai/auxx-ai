// apps/web/src/components/money/ui/invoice/create-invoice-action.tsx
'use client'

// Work-order drawer header action (money MI1 build spec §J.5, the
// create-quote-action precedent): Receipt icon button opening the gather-
// invoice dialog. Always rendered — the dialog itself owns the empty state
// ("No uninvoiced lines on this job"), so there's no lookup gate here like
// create-quote-action's existing-quote check.

import { Button } from '@auxx/ui/components/button'
import { Receipt } from 'lucide-react'
import { useState } from 'react'
import type { DrawerActionProps } from '~/components/drawers/drawer-action-registry'
import { Tooltip } from '~/components/global/tooltip'
import { GatherInvoiceDialog } from './gather-invoice-dialog'

export function CreateInvoiceAction({ recordId }: DrawerActionProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Tooltip content='Create invoice' allowInteraction>
        <Button variant='ghost' size='icon-xs' onClick={() => setOpen(true)}>
          <Receipt />
        </Button>
      </Tooltip>
      <GatherInvoiceDialog open={open} onOpenChange={setOpen} workOrderRecordId={recordId} />
    </>
  )
}
