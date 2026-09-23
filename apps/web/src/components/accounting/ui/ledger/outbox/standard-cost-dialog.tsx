// apps/web/src/components/accounting/ui/ledger/outbox/standard-cost-dialog.tsx
'use client'

import { toRecordId } from '@auxx/lib/resources/client'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Kbd } from '@auxx/ui/components/kbd'
import Link from 'next/link'
import { PartCostingCard } from '~/components/drawers/cards/part-costing-card'
import { useResourceProperty } from '~/components/resources'
import { RecordBadge } from '~/components/resources/ui/record-badge'

interface StandardCostDialogProps {
  /** The part's entityInstanceId; `null` keeps the dialog closed. */
  partId: string | null
  onOpenChange: (open: boolean) => void
}

/** The part drawer's Costing section in place, for a `STANDARD_COST_MISSING` group. */
export function StandardCostDialog({ partId, onOpenChange }: StandardCostDialogProps) {
  const partDefId = useResourceProperty('part', 'id')
  const recordId = partId && partDefId ? toRecordId(partDefId, partId) : null

  return (
    <Dialog open={partId !== null} onOpenChange={onOpenChange}>
      <DialogContent position='tc' size='lg'>
        <DialogHeader>
          <DialogTitle>Set the standard cost</DialogTitle>
          <DialogDescription>
            Rolling the standard retries everything waiting on it.
          </DialogDescription>
        </DialogHeader>
        {recordId && partId && (
          <>
            <RecordBadge recordId={recordId} size='sm' />
            <PartCostingCard recordId={recordId} entityInstanceId={partId} />
          </>
        )}
        <DialogFooter>
          {partId && (
            <Button variant='ghost' size='sm' asChild>
              <Link href={`/app/parts/${encodeURIComponent(partId)}`}>Open part</Link>
            </Button>
          )}
          <Button variant='outline' size='sm' onClick={() => onOpenChange(false)}>
            Done <Kbd shortcut='esc' variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
