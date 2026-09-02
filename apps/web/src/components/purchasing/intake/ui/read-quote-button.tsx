// apps/web/src/components/purchasing/intake/ui/read-quote-button.tsx
'use client'

// The entry point on the purchase orders list — `RecordsView`'s `pageActions`
// slot, beside Create (plans/money/tasks/38 §6.2).

import { Button } from '@auxx/ui/components/button'
import { FileUp } from 'lucide-react'
import { useState } from 'react'
import { QuoteIntakeDialog } from './quote-intake-dialog'

export function ReadQuoteButton() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button variant='outline' size='sm' onClick={() => setOpen(true)}>
        <FileUp /> Read a quote
      </Button>
      {/* Mounted only while open so the capability check (which runs ON OPEN, not
          after the upload) is not a query on every visit to the list. */}
      {open && <QuoteIntakeDialog open={open} onOpenChange={setOpen} />}
    </>
  )
}
