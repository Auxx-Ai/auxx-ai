// apps/web/src/components/manufacturing/builds/backfill-builds-button.tsx
'use client'

// The entry point on the builds list — `RecordsView`'s `pageActions` slot,
// beside Create (plans/money/tasks/44 §11.3). Same shape as
// `purchasing/intake/ui/read-quote-button.tsx`, which is the precedent for a
// list-level action that opens a dialog.
//
// 🛑 A standalone tool, not a wizard step (§7). The cutover checklist links here
// at its step 6, but the other half of this dialog's life is ordinary: a
// connector was off for a week, or auto-build was switched on late, and demand
// has run ahead of builds. An entry point that only existed inside an onboarding
// flow could not be reached then.

import { Button } from '@auxx/ui/components/button'
import { Layers } from 'lucide-react'
import { useState } from 'react'
import { api } from '~/trpc/react'
import { BackfillDialog } from './backfill-dialog'

export function BackfillBuildsButton() {
  const [open, setOpen] = useState(false)
  const utils = api.useUtils()

  return (
    <>
      <Button variant='outline' size='sm' onClick={() => setOpen(true)}>
        <Layers /> Backfill builds
      </Button>
      {/* Mounted only while open so the preview query does not run on every
          visit to the list. Same reasoning as `ReadQuoteButton`. */}
      {open && (
        <BackfillDialog
          open={open}
          onOpenChange={setOpen}
          // The run writes builds the list is showing, and a batch build is
          // written on a lane the list does not learn about on its own.
          onCompleted={() => void utils.invalidate()}
        />
      )}
    </>
  )
}
