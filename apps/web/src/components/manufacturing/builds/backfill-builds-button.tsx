// apps/web/src/components/manufacturing/builds/backfill-builds-button.tsx
'use client'

// Inventory > General's entry to the backfill (plans/money/tasks/44 §7): raise batch builds for
// orders placed before auto-build's cutoff. A standing tool, not a wizard step.

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
      {/* Mounted only while open so the preview query does not run on every visit. */}
      {open && (
        <BackfillDialog
          open={open}
          onOpenChange={setOpen}
          onCompleted={() => void utils.builds.invalidate()}
        />
      )}
    </>
  )
}
