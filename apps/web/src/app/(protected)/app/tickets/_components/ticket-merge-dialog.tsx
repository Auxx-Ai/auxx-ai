// apps/web/src/app/(protected)/app/tickets/_components/ticket-merge-dialog.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@auxx/ui/components/dialog'
import { Button } from '@auxx/ui/components/button'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { api } from '~/trpc/react'
import { MultiRelationInput } from '~/components/shared/multi-relation-input'

/**
 * Props for TicketMergeDialog
 */
interface TicketMergeDialogProps {
  /** The primary ticket ID that other tickets will be merged into */
  primaryTicketId: string
  /** Controlled open state */
  open?: boolean
  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void
  /** Callback when merge completes successfully */
  onMergeComplete?: () => void
  /** Optional trigger element */
  trigger?: React.ReactNode
}

/**
 * TicketMergeDialog - Dialog for merging multiple tickets into a primary ticket
 * Uses MultiRelationInput to fetch and select tickets internally
 */
export function TicketMergeDialog({
  primaryTicketId,
  open,
  onOpenChange,
  onMergeComplete,
  trigger,
}: TicketMergeDialogProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [ticketsToMergeIds, setTicketsToMergeIds] = useState<string[]>([])
  const router = useRouter()

  // Use controlled or uncontrolled open state
  const dialogOpen = open ?? isOpen
  const setDialogOpen = onOpenChange ?? setIsOpen

  const { mutate: mergeTickets, isPending } = api.ticket.mergeTickets.useMutation({
    onSuccess: () => {
      toastSuccess({ description: 'Tickets have been successfully merged' })
      setDialogOpen(false)
      setTicketsToMergeIds([])
      router.refresh()
      onMergeComplete?.()
    },
    onError: (error) => {
      toastError({ title: 'Error', description: error.message })
    },
  })

  /**
   * Handle merge action
   */
  const handleMerge = () => {
    if (ticketsToMergeIds.length === 0) {
      toastError({
        title: 'Invalid selection',
        description: 'Please select at least one ticket to merge',
      })
      return
    }
    mergeTickets({ primaryTicketId, ticketsToMergeIds })
  }

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent size="sm">
        <DialogHeader className="mb-4">
          <DialogTitle>Merge Tickets</DialogTitle>
          <DialogDescription>
            Select tickets to merge into the current ticket. The merged tickets will become child
            tickets.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <label className="text-sm font-medium">Tickets to Merge</label>
            <MultiRelationInput
              resourceId="ticket"
              value={ticketsToMergeIds}
              onChange={setTicketsToMergeIds}
              excludeIds={[primaryTicketId]}
              placeholder="Search tickets to merge..."
              multi={true}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setDialogOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={handleMerge}
            disabled={ticketsToMergeIds.length === 0}
            loading={isPending}
            loadingText="Merging...">
            Merge Tickets
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
