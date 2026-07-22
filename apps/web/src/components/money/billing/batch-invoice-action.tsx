// apps/web/src/components/money/billing/batch-invoice-action.tsx
'use client'

// Toolbar entry point for batch advance invoicing (plans/dispatch/37a-batch-advance-invoicing.md
// §3, decision #4) — self-contained Button + `BillingActionDialog` in `batch` scope, owning its
// own open state. Rendered from both `/app/invoices` and `/app/work-orders` (`RecordsView`'s
// `pageActions` slot).

import { Button } from '@auxx/ui/components/button'
import { ReceiptText } from 'lucide-react'
import { useState } from 'react'
import { BillingActionDialog } from './billing-action-dialog'

export function BatchInvoiceAction() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button size='sm' variant='outline' className='h-7 rounded-lg' onClick={() => setOpen(true)}>
        <ReceiptText />
        Batch invoice
      </Button>
      <BillingActionDialog open={open} onOpenChange={setOpen} scope={{ kind: 'batch' }} />
    </>
  )
}
