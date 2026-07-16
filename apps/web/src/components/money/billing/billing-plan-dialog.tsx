// apps/web/src/components/money/billing/billing-plan-dialog.tsx
'use client'

import { COMPATIBLE_BILLING_TIMINGS } from '@auxx/lib/money/client'
import type { RecordId } from '@auxx/types/resource'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { toastError } from '@auxx/ui/components/toast'
import { useEffect, useState } from 'react'
import { api } from '~/trpc/react'
import { BillingPlanController } from './billing-plan-controller'
import type { BillingBasis, BillingTiming } from './types'

interface BillingPlanDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workOrderRecordId: RecordId
  basis: BillingBasis
  timing: BillingTiming
}

/** Purpose-built billing basis/timing editor that never offers an invalid combination. */
export function BillingPlanDialog({
  open,
  onOpenChange,
  workOrderRecordId,
  basis: initialBasis,
  timing: initialTiming,
}: BillingPlanDialogProps) {
  const [basis, setBasis] = useState(initialBasis)
  const [timing, setTiming] = useState(initialTiming)
  const utils = api.useUtils()
  useEffect(() => {
    if (open) {
      setBasis(initialBasis)
      setTiming(
        COMPATIBLE_BILLING_TIMINGS[initialBasis].includes(initialTiming)
          ? initialTiming
          : COMPATIBLE_BILLING_TIMINGS[initialBasis][0]!
      )
    }
  }, [open, initialBasis, initialTiming])
  const update = api.record.update.useMutation({
    onSuccess: async () => {
      await utils.money.getWorkOrderBillingState.invalidate({ workOrderRecordId })
      onOpenChange(false)
    },
    onError: (error) =>
      toastError({ title: 'Error updating billing plan', description: error.message }),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent position='tc'>
        <DialogHeader>
          <DialogTitle>Edit billing plan</DialogTitle>
          <DialogDescription>
            Choose how this work is priced and when it becomes ready to invoice.
          </DialogDescription>
        </DialogHeader>

        <BillingPlanController
          basis={basis}
          timing={timing}
          onBasisChange={setBasis}
          onTimingChange={setTiming}
        />

        <DialogFooter>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            disabled={update.isPending}
            onClick={() => onOpenChange(false)}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            variant='outline'
            size='sm'
            loading={update.isPending}
            loadingText='Saving...'
            onClick={() =>
              update.mutate({
                recordId: workOrderRecordId,
                values: { work_order_pricing_model: basis, work_order_invoice_timing: timing },
              })
            }
            data-dialog-submit>
            Save plan <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
