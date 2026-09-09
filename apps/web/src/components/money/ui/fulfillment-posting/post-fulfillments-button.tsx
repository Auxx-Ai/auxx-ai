// apps/web/src/components/money/ui/fulfillment-posting/post-fulfillments-button.tsx
'use client'

// The entry point on the orders list, `RecordsView`'s `pageActions` slot,
// beside Create (plans/money/tasks/49 §8.6 lane E). Same shape as
// `manufacturing/builds/backfill-builds-button.tsx`, which is the precedent for
// a list-level action that opens a batch dialog.
//
// 🛑 Gated on `ledger.post`, the same key the per-order Fulfill button takes and
// for the same reason: this writes `GlPosting` rows. A reader who cannot post an
// entry has no use for a preview of one, and the router refuses the mutation
// regardless, hiding the button is so the refusal never has to be explained.

import { Button } from '@auxx/ui/components/button'
import { BookOpenCheck } from 'lucide-react'
import { useState } from 'react'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { PostFulfillmentsDialog } from './post-fulfillments-dialog'

export function PostFulfillmentsButton() {
  const [open, setOpen] = useState(false)
  const { can } = useAccess()
  const utils = api.useUtils()

  if (!can('ledger.post')) return null

  return (
    <>
      <Button variant='outline' size='sm' onClick={() => setOpen(true)}>
        <BookOpenCheck /> Post fulfillments
      </Button>
      {/* Mounted only while open so the preview query does not run on every
          visit to the orders list. Same reasoning as `BackfillBuildsButton`. */}
      {open && (
        <PostFulfillmentsDialog
          open={open}
          onOpenChange={setOpen}
          // The run stamps the shipment log of every order it covered, and the
          // list is showing those orders.
          onCompleted={() => void utils.invalidate()}
        />
      )}
    </>
  )
}
