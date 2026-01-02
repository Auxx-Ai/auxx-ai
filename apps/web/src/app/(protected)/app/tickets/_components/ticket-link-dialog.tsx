// apps/web/src/app/(protected)/app/tickets/_components/ticket-link-dialog.tsx
'use client'

import { useMemo, useState } from 'react'
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
import { api } from '~/trpc/react'
import { MultiRelationInput } from '~/components/shared/multi-relation-input'

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
 * Uses MultiRelationInput to fetch and select tickets internally
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

  // Use controlled or uncontrolled open state
  const dialogOpen = open ?? isOpen
  const setDialogOpen = onOpenChange ?? setIsOpen

  // Combine current ticket + already related into excludeIds
  const excludeIds = useMemo(
    () => [ticketId, ...relatedTicketIds],
    [ticketId, relatedTicketIds]
  )

  // Mutation to add a relation
  const addRelationMutation = api.ticket.addRelation.useMutation({
    onSuccess: () => {
      setDialogOpen(false)
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
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
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
            <MultiRelationInput
              resourceId="ticket"
              value={selectedTicketId ? [selectedTicketId] : []}
              onChange={(ids) => setSelectedTicketId(ids[0] || null)}
              excludeIds={excludeIds}
              placeholder="Search tickets..."
              multi={false}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setDialogOpen(false)}>
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
