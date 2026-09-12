// apps/web/src/components/money/ui/credit-memo-posting/post-credit-memos-button.tsx
'use client'

// The entry point on the credit memos list, `RecordsView`'s `pageActions` slot,
// beside Create (plans/accounting/tasks/25-batch-posting-and-credit-memos.md §9
// item 14). Mirrors `fulfillment-posting/post-fulfillments-button.tsx` on the
// orders page.
//
// 🛑 Gated on `ledger.post`, the same key issuing one memo takes and for the same
// reason: this writes `GlPosting` rows. A reader who cannot post an entry has no
// use for a preview of one, and the router refuses the mutation regardless -
// hiding the button is so the refusal never has to be explained.

import { Button } from '@auxx/ui/components/button'
import { BookOpenCheck } from 'lucide-react'
import { useState } from 'react'
import { useAccess } from '~/providers/capabilities-provider'
import { api } from '~/trpc/react'
import { PostCreditMemosDialog } from './post-credit-memos-dialog'

export function PostCreditMemosButton() {
  const [open, setOpen] = useState(false)
  const { can } = useAccess()
  const utils = api.useUtils()

  if (!can('ledger.post')) return null

  return (
    <>
      <Button variant='outline' size='sm' onClick={() => setOpen(true)}>
        <BookOpenCheck /> Post credit memos
      </Button>
      {/* Mounted only while open so the preview query does not run on every
          visit to the credit memos list. Same reasoning as
          `PostFulfillmentsButton`. */}
      {open && (
        <PostCreditMemosDialog
          open={open}
          onOpenChange={setOpen}
          // The run stamps `credit_memo_gl_posting` on every memo it covered, and
          // the list is showing those memos.
          onCompleted={() => void utils.invalidate()}
        />
      )}
    </>
  )
}
