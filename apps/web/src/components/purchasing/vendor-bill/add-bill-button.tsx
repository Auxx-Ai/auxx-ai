// apps/web/src/components/purchasing/vendor-bill/add-bill-button.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { AddBillDialog } from './add-bill-dialog'

/** Page action for opening the shared bill chooser without a PO context. */
export function AddBillButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant='outline' size='sm' onClick={() => setOpen(true)}>
        <Plus /> Add bill
      </Button>
      {open && <AddBillDialog open={open} onOpenChange={setOpen} />}
    </>
  )
}
