// apps/web/src/app/(protected)/app/tickets/_components/ticket-link-dialog.tsx
'use client'

import { useEffect, useState } from 'react'
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
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@auxx/ui/components/command'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { cn } from '@auxx/ui/lib/utils'
import { api } from '~/trpc/react'

/**
 * Relation types with human-readable labels
 */
const RELATION_TYPES = [
  { value: 'RELATED', label: 'Related to' },
  { value: 'BLOCKED_BY', label: 'Blocked by' },
  { value: 'DUPLICATE_OF', label: 'Duplicate of' },
  { value: 'PARENT_OF', label: 'Parent of' },
  { value: 'CHILD_OF', label: 'Child of' },
  { value: 'CONVERTED_FROM', label: 'Converted from' },
]

/**
 * Props for TicketLinkDialog component
 */
interface TicketLinkDialogProps {
  ticketId: string
  relatedTicketIds: string[]
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onSuccess?: () => void
  trigger?: React.ReactNode
}

/**
 * TicketLinkDialog component - allows linking tickets with different relation types
 */
export function TicketLinkDialog({
  ticketId,
  relatedTicketIds,
  open,
  onOpenChange,
  onSuccess,
  trigger,
}: TicketLinkDialogProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null)
  const [relationType, setRelationType] = useState<string>('RELATED')

  // Sync internal state with external open prop
  useEffect(() => {
    if (open !== undefined) {
      setIsOpen(open)
    }
  }, [open])

  // Handle open change
  const handleOpenChange = (newOpen: boolean) => {
    setIsOpen(newOpen)
    onOpenChange?.(newOpen)
  }

  // Get all tickets for selection
  const { data: allTicketsData } = api.ticket.all.useQuery({})

  // Filter out the current ticket and already related tickets
  const availableTickets = (allTicketsData?.tickets || []).filter(
    (t) => t.id !== ticketId && !relatedTicketIds.includes(t.id)
  )

  // Mutation to add a relation
  const addRelationMutation = api.ticket.addRelation.useMutation({
    onSuccess: () => {
      handleOpenChange(false)
      setSelectedTicketId(null)
      setRelationType('RELATED')
      onSuccess?.()
    },
  })

  /**
   * Handle adding a relation
   */
  const handleAddRelation = async () => {
    if (!selectedTicketId) return

    await addRelationMutation.mutateAsync({
      ticketId,
      relatedTicketId: selectedTicketId,
      relation: relationType,
    })
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent size="sm">
        <DialogHeader className="mb-4">
          <DialogTitle>Link a related ticket</DialogTitle>
          <DialogDescription>Connect this ticket to another existing ticket.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="space-y-1 flex flex-col">
            <label className="text-sm font-medium">Relation type</label>
            <Select value={relationType} onValueChange={setRelationType}>
              <SelectTrigger>
                <SelectValue placeholder="Select relation type" />
              </SelectTrigger>
              <SelectContent>
                {RELATION_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1 flex flex-col">
            <label className="text-sm font-medium">Select ticket</label>
            <Command className="rounded-md border">
              <CommandInput placeholder="Search tickets..." />
              <CommandList>
                <CommandEmpty>No tickets found.</CommandEmpty>
                <CommandGroup>
                  {availableTickets.map((t) => (
                    <CommandItem
                      key={t.id}
                      value={t.id}
                      onSelect={() => setSelectedTicketId(t.id)}
                      className={cn(
                        'flex items-center justify-between',
                        selectedTicketId === t.id && 'bg-accent'
                      )}>
                      <div>
                        <span className="mr-2 font-mono text-xs text-muted-foreground">
                          {t.number}
                        </span>
                        <span>{t.title}</span>
                      </div>
                      {selectedTicketId === t.id && <span className="text-blue-500">✓</span>}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleAddRelation}
            disabled={!selectedTicketId || addRelationMutation.isPending}
            loading={addRelationMutation.isPending}
            loadingText="Adding...">
            Add Link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
