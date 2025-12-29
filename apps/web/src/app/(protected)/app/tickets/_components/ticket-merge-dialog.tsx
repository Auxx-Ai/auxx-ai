// src/components/tickets/TicketMergeDialog.tsx
'use client'
import { useEffect, useState } from 'react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { api } from '~/trpc/react'
import { MultiSelectFilter } from '~/components/global/multi-select-filter'
import type { TicketEntity as Ticket } from '@auxx/database/models'
interface TicketMergeDialogProps {
  tickets: Ticket[]
  open?: boolean
  primaryTicketId?: string
  onMergeComplete?: () => void
  trigger?: React.ReactNode
}
export function TicketMergeDialog({
  tickets,
  open,
  primaryTicketId,
  onMergeComplete,
  trigger,
}: TicketMergeDialogProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedPrimaryTicketId, setSelectedPrimaryTicketId] = useState<string>(
    primaryTicketId || ''
  )
  const [ticketsToMergeIds, setTicketsToMergeIds] = useState<string[]>([])
  const router = useRouter()
  useEffect(() => {
    if (open !== undefined) {
      setIsOpen(open)
    }
  }, [open])
  const { mutate: mergeTickets, isPending } = api.ticket.mergeTickets.useMutation({
    onSuccess: () => {
      toastSuccess({ description: 'Tickets have been successfully merged' })
      setIsOpen(false)
      setSelectedPrimaryTicketId('')
      setTicketsToMergeIds([])
      router.refresh()
      if (onMergeComplete) onMergeComplete()
    },
    onError: (error) => {
      toastError({ title: 'Error', description: error.message })
    },
  })
  const handleMerge = () => {
    if (!selectedPrimaryTicketId || ticketsToMergeIds.length === 0) {
      toastError({
        title: 'Invalid selection',
        description: 'Please select a primary ticket and at least one ticket to merge',
      })
      return
    }
    mergeTickets({ primaryTicketId: selectedPrimaryTicketId, ticketsToMergeIds })
  }
  // Filter out tickets already selected for merging from primary ticket options
  const primaryTicketOptions = tickets.filter((ticket) => !ticketsToMergeIds.includes(ticket.id))
  // Filter out primary ticket from merge options
  const mergeTicketOptions = tickets.filter((ticket) => ticket.id !== selectedPrimaryTicketId)
  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent size="sm">
        <DialogHeader className="mb-4">
          <DialogTitle>Merge Tickets</DialogTitle>
          <DialogDescription>
            Select a primary ticket that will remain after merging, and the tickets to merge into
            it. The merged tickets will become child tickets of the primary ticket.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <label htmlFor="primaryTicket" className="text-sm font-medium">
              Primary Ticket
            </label>
            <Select
              value={selectedPrimaryTicketId}
              onValueChange={(value) => setSelectedPrimaryTicketId(value)}>
              <SelectTrigger id="primaryTicket">
                <SelectValue placeholder="Select primary ticket" />
              </SelectTrigger>
              <SelectContent>
                {primaryTicketOptions.map((ticket) => (
                  <SelectItem key={ticket.id} value={ticket.id}>
                    {ticket.id.substring(0, 8)} - {ticket.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <label htmlFor="ticketsToMerge" className="text-sm font-medium">
              Tickets to Merge
            </label>
            <MultiSelectFilter
              title="Tickets"
              options={mergeTicketOptions.map((ticket) => ({
                label: `${ticket.id.substring(0, 8)} - ${ticket.title}`,
                value: ticket.id,
              }))}
              selectedValues={new Set(ticketsToMergeIds)}
              setSelectedValues={(selectedValues) =>
                setTicketsToMergeIds(Array.from(selectedValues))
              }
              // onChange={setTicketsToMergeIds}
              placeholder="Select tickets to merge"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={handleMerge}
            loading={isPending}
            loadingText="Merging...">
            Merge Tickets
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
