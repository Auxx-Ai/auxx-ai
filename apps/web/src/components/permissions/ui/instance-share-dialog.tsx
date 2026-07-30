// apps/web/src/components/permissions/ui/instance-share-dialog.tsx
'use client'

import type { RecordId } from '@auxx/types/resource'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { useInstanceShareCopy } from '../hooks/use-instance-share-copy'
import { InstanceShareCard } from './instance-share-card'

/**
 * The modal host for {@link InstanceShareCard} — the shared dialog every
 * instance-access consumer opens from its own trigger — and, since plan v3/03
 * P5, the record drawer and records table row menu too. Title/description derive
 * from {@link useInstanceShareCopy}, so the dialog is genuinely generic over
 * `recordId` rather than only over the nine registry keys.
 */
export function InstanceShareDialog({
  recordId,
  open,
  onOpenChange,
}: {
  recordId: RecordId
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  // Resolves BOTH lanes (plan v3/03 §6.3): a registry entry for a config-scale
  // resource, or the def's own singular name for a record row.
  const copy = useInstanceShareCopy(recordId)
  const noun = copy?.noun ?? 'item'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent position='tc' size='sm'>
        <DialogHeader>
          <DialogTitle className='capitalize'>Share {noun}</DialogTitle>
          <DialogDescription>
            Choose who can access this {noun} and what they can do.
          </DialogDescription>
        </DialogHeader>
        {open && <InstanceShareCard recordId={recordId} />}
      </DialogContent>
    </Dialog>
  )
}
