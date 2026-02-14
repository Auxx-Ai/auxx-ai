// apps/web/src/app/(protected)/app/tickets/_components/dialog-mass-deleting.tsx

'use client'

import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { AlertTriangle } from 'lucide-react'
import { useRecordInvalidation } from '~/components/resources'
import { api } from '~/trpc/react'

interface MassDeleteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  ticketIds: string[]
  onSuccess: () => void
}

export function MassDeleteDialog({
  open,
  onOpenChange,
  ticketIds,
  onSuccess,
}: MassDeleteDialogProps) {
  const { onBulkDeleted } = useRecordInvalidation()

  const deleteTickets = api.ticket.deleteMultipleTickets.useMutation({
    onSuccess: () => {
      toastSuccess({ title: `Successfully deleted ${ticketIds.length} ticket(s)` })
      onBulkDeleted('ticket', ticketIds)
      onSuccess()
      onOpenChange(false)
    },
    onError: (error) => {
      toastError({ description: `Error: ${error.message}` })
    },
  })

  const handleDelete = async () => {
    await deleteTickets.mutateAsync({ ticketIds })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size='sm' position='tc'>
        <DialogHeader>
          <DialogTitle>Delete Tickets</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete {ticketIds.length} selected ticket(s)?
          </DialogDescription>
        </DialogHeader>

        <Alert variant='destructive'>
          <AlertTriangle />
          <AlertTitle>Warning</AlertTitle>
          <AlertDescription>
            This action cannot be undone. All selected tickets will be permanently deleted,
            including all their notes, replies, and attachments.
          </AlertDescription>
        </Alert>

        <DialogFooter>
          <Button
            variant='outline'
            size='sm'
            onClick={() => onOpenChange(false)}
            disabled={deleteTickets.isPending}>
            Cancel
          </Button>
          <Button
            size='sm'
            variant='destructive'
            onClick={handleDelete}
            loading={deleteTickets.isPending}
            loadingText='Deleting...'>
            Delete Tickets
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
