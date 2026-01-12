// apps/web/src/app/(protected)/app/tickets/_components/dialog-mass-status.tsx

'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { useDialogSubmit } from '@auxx/ui/hooks'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { Button } from '@auxx/ui/components/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { api } from '~/trpc/react'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { useRecordInvalidation } from '~/components/resources'

// Enum values
const TicketStatus = {
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  WAITING_FOR_CUSTOMER: 'WAITING_FOR_CUSTOMER',
  WAITING_FOR_THIRD_PARTY: 'WAITING_FOR_THIRD_PARTY',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
}

interface MassStatusDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  ticketIds: string[]
  onSuccess: () => void
}

export function MassStatusDialog({
  open,
  onOpenChange,
  ticketIds,
  onSuccess,
}: MassStatusDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" position="tc">
        <MassStatusDialogContent
          ticketIds={ticketIds}
          onSuccess={onSuccess}
          onClose={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

/** Inner content props */
interface MassStatusDialogContentProps {
  ticketIds: string[]
  onSuccess: () => void
  onClose: () => void
}

/** Inner content component - must be inside DialogContent for useDialogSubmit to work */
function MassStatusDialogContent({ ticketIds, onSuccess, onClose }: MassStatusDialogContentProps) {
  const [status, setStatus] = useState<string>('')
  const { onBulkUpdated } = useRecordInvalidation()

  const updateStatus = api.ticket.updateMultipleStatus.useMutation({
    onSuccess: () => {
      toastSuccess({ title: `Successfully updated ${ticketIds.length} ticket(s) status` })
      onBulkUpdated('ticket', ticketIds)
      onSuccess()
      onClose()
    },
    onError: (error) => {
      toastError({ description: `Error: ${error.message}` })
    },
  })

  const handleSubmit = async () => {
    if (!status) {
      toastError({ title: 'Please select a status' })
      return
    }

    await updateStatus.mutateAsync({ ticketIds, status: status as any })
  }

  // Register Meta+Enter submit handler
  useDialogSubmit({
    onSubmit: handleSubmit,
    disabled: updateStatus.isPending || !status,
  })

  return (
    <>
      <DialogHeader>
        <DialogTitle>Update Ticket Status</DialogTitle>
        <DialogDescription>
          Change the status for {ticketIds.length} selected ticket(s).
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-1 flex flex-col">
        <label className="text-sm font-medium">Select Status</label>
        <Select value={status} onValueChange={setStatus} disabled={updateStatus.isPending}>
          <SelectTrigger>
            <SelectValue placeholder="Select a new status" />
          </SelectTrigger>
          <SelectContent>
            {Object.values(TicketStatus).map((statusOption) => (
              <SelectItem key={statusOption} value={statusOption}>
                {statusOption.replace(/_/g, ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DialogFooter>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          disabled={updateStatus.isPending}>
          Cancel <Kbd shortcut="esc" variant="ghost" size="sm" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSubmit}
          disabled={updateStatus.isPending || !status}
          loading={updateStatus.isPending}
          loadingText="Updating...">
          Update Status <KbdSubmit variant="outline" size="sm" />
        </Button>
      </DialogFooter>
    </>
  )
}
