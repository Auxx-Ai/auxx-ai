// apps/web/src/components/permissions/ui/instance-share-dialog.tsx
'use client'

import type { RecordId } from '@auxx/types/resource'
import { parseRecordId } from '@auxx/types/resource'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { InstanceShareCard } from './instance-share-card'
import { INSTANCE_SHARE_COPY } from './instance-share-copy'

/**
 * The modal host for {@link InstanceShareCard} — the shared dialog every
 * instance-access consumer (datasets now; KB / dashboards later) opens from its
 * own trigger. Title/description derive from the resource's copy entry, so the
 * dialog is generic over `recordId`.
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
  const { entityDefinitionId: key } = parseRecordId(recordId)
  const copy = INSTANCE_SHARE_COPY[key as keyof typeof INSTANCE_SHARE_COPY]
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
