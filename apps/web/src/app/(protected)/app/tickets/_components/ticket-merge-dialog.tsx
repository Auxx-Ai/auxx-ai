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
import { useDialogSubmit } from '@auxx/ui/hooks'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
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

  // Use controlled or uncontrolled open state
  const dialogOpen = open ?? isOpen
  const setDialogOpen = onOpenChange ?? setIsOpen

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent size="sm">
        <TicketMergeDialogContent
          primaryTicketId={primaryTicketId}
          onClose={() => setDialogOpen(false)}
          onMergeComplete={onMergeComplete}
        />
      </DialogContent>
    </Dialog>
  )
}

/** Inner content props */
interface TicketMergeDialogContentProps {
  primaryTicketId: string
  onClose: () => void
  onMergeComplete?: () => void
}

/** Inner content component - must be inside DialogContent for useDialogSubmit to work */
function TicketMergeDialogContent({
  primaryTicketId,
  onClose,
  onMergeComplete,
}: TicketMergeDialogContentProps) {
  const [ticketsToMergeIds, setTicketsToMergeIds] = useState<string[]>([])
  const router = useRouter()

  const { mutate: mergeTickets, isPending } = api.ticket.mergeTickets.useMutation({
    onSuccess: () => {
      toastSuccess({ description: 'Tickets have been successfully merged' })
      onClose()
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

  // Register Meta+Enter submit handler
  useDialogSubmit({
    onSubmit: handleMerge,
    disabled: ticketsToMergeIds.length === 0 || isPending,
  })

  return (
    <>
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
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel <Kbd shortcut="esc" variant="ghost" size="sm" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleMerge}
          disabled={ticketsToMergeIds.length === 0}
          loading={isPending}
          loadingText="Merging...">
          Merge Tickets <KbdSubmit variant="outline" size="sm" />
        </Button>
      </DialogFooter>
    </>
  )
}
